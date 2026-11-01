/**
 * db-clean - database access.
 *
 * Everything the engine does goes through a tiny interface so the SAME code can run over two transports:
 *   TcpDb   - the `pg` driver over TCP (audit, and everything before the fence goes up / after it comes down).
 *   PsqlDb  - a long-lived `psql` child process inside the postgres container, over the Unix socket (docker exec -i).
 *             This is the only way in while the pg_hba fence is up: the fence rejects every TCP connection, including superusers.
 *
 * Interface:  exec(sql, params?)  -> void (statement, no result)
 *             json(sql, params?)  -> the single cell of the single row the statement returns, parsed from json (or a plain value)
 *             close()
 * Every `json` statement must return exactly one row with one column.
 */
import { spawn, spawnSync } from 'node:child_process';
import pg from 'pg';
import { bindParams } from './util.mjs';
import { MAINT_APP_NAME } from './config.mjs';

// ------------------------------------------------------------------ docker helpers
export function docker(args, { input, env, timeout, cwd } = {}) {
  const r = spawnSync('docker', args, {
    input,
    encoding: 'utf8',
    env: { ...process.env, ...(env || {}) },
    maxBuffer: 1 << 30,
    timeout,
    cwd,
    windowsHide: true,
  });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', error: r.error };
}

/** docker exec [-u user] container cmd... ; `env` values go through the child's environment (name-only -e), never argv. */
export function dockerExec(container, cmd, { user, env, input, timeout } = {}) {
  const args = ['exec'];
  if (input !== undefined) args.push('-i');
  if (user) args.push('-u', user);
  for (const k of Object.keys(env || {})) args.push('-e', k);
  args.push(container, ...cmd);
  return docker(args, { input, env, timeout });
}

export function containerRunning(container) {
  const r = docker(['inspect', '-f', '{{.State.Running}}', container]);
  return r.status === 0 && r.stdout.trim() === 'true';
}
export function containerExists(container) {
  return docker(['inspect', '-f', '{{.Id}}', container]).status === 0;
}

// ------------------------------------------------------------------ TCP
export class TcpDb {
  constructor({ host, port, user, password, database, readOnly = false, appName = MAINT_APP_NAME }) {
    this.database = database;
    this.readOnly = readOnly;
    this.client = new pg.Client({ host, port, user, password, database, application_name: appName, connectionTimeoutMillis: 8000 });
    this.transport = 'tcp';
  }
  async connect() {
    await this.client.connect();
    if (this.readOnly) await this.client.query('SET default_transaction_read_only = on');
    return this;
  }
  async exec(sql, params) {
    await this.client.query(sql, params && params.length ? params : undefined);
  }
  async json(sql, params) {
    const r = await this.client.query(sql, params && params.length ? params : undefined);
    if (r.rows.length !== 1) throw new Error(`json(): expected exactly one row, got ${r.rows.length}`);
    const v = Object.values(r.rows[0])[0];
    return v;
  }
  async close() {
    await this.client.end().catch(() => {});
  }
}

// ------------------------------------------------------------------ psql child (docker exec) - used under the fence
let sentinelCounter = 0;
export class PsqlDb {
  /** @param {{container:string,user:string,password:string,database:string,appName?:string}} o */
  constructor({ container, user, password, database, appName = MAINT_APP_NAME }) {
    this.container = container;
    this.user = user;
    this.database = database;
    this.password = password;
    this.appName = appName;
    this.transport = 'psql-socket';
    this.out = '';
    this.err = '';
    this.exited = null;
    this.waiter = null;
  }
  async connect() {
    const args = [
      'exec', '-i', '-e', 'PGPASSWORD', '-e', 'PGAPPNAME', this.container,
      'psql', '-X', '-q', '-A', '-t', '-v', 'VERBOSITY=terse', '-v', 'ON_ERROR_STOP=0',
      '-h', '/var/run/postgresql', '-U', this.user, '-d', this.database,
    ];
    this.child = spawn('docker', args, {
      env: { ...process.env, PGPASSWORD: this.password, PGAPPNAME: this.appName },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    this.child.stdout.setEncoding('utf8');
    this.child.stderr.setEncoding('utf8');
    this.child.stdout.on('data', (d) => {
      this.out += d;
      this._check();
    });
    this.child.stderr.on('data', (d) => {
      this.err += d;
      this._check();
    });
    this.child.on('exit', (code, sig) => {
      this.exited = { code, sig };
      this._check();
    });
    this.child.on('error', (e) => {
      this.exited = { code: -1, sig: null, error: e };
      this._check();
    });
    // handshake: proves the connection (and the auth rule) works
    await this.exec('SELECT 1');
    return this;
  }
  _check() {
    if (this.waiter) this.waiter();
  }
  async _send(sql) {
    if (this.exited) throw new Error(`psql session to ${this.database} is gone (${JSON.stringify(this.exited.error ? String(this.exited.error) : this.exited)}) ${this.err.trim().slice(0, 300)}`);
    const id = `__DBCLEAN_END_${process.pid}_${++sentinelCounter}__`;
    this.out = '';
    this.err = '';
    const text = sql.trim().replace(/;+\s*$/, '');
    this.child.stdin.write(`${text};\n\\echo ${id}\n\\warn ${id}\n`);
    await new Promise((resolve, reject) => {
      this.waiter = () => {
        if (this.out.includes(id) && this.err.includes(id)) {
          this.waiter = null;
          resolve();
        } else if (this.exited) {
          this.waiter = null;
          reject(new Error(`psql session to ${this.database} ended: ${this.err.trim().slice(0, 400)}`));
        }
      };
      this.waiter();
    });
    const out = this.out.slice(0, this.out.indexOf(id)).trim();
    const err = this.err.slice(0, this.err.indexOf(id)).trim();
    return { out, err };
  }
  static _hasError(err) {
    return /(^|\n)(ERROR|FATAL|PANIC):/.test(err);
  }
  async exec(sql, params) {
    const { err } = await this._send(bindParams(sql, params));
    if (PsqlDb._hasError(err)) throw new Error(err);
  }
  async json(sql, params) {
    const { out, err } = await this._send(bindParams(sql, params));
    if (PsqlDb._hasError(err)) throw new Error(err);
    if (out === '') return null;
    // json_agg separates elements with a newline; a raw newline can never occur inside a JSON string (it is escaped), so joining is lossless
    const flat = out.split('\n').join('');
    try {
      return JSON.parse(flat);
    } catch {
      return out; // a plain scalar (count, text)
    }
  }
  async close() {
    if (!this.child || this.exited) return;
    try {
      this.child.stdin.write('\\q\n');
      this.child.stdin.end();
    } catch {
      /* ignore */
    }
    await new Promise((r) => {
      const t = setTimeout(() => {
        try {
          this.child.kill();
        } catch {
          /* ignore */
        }
        r();
      }, 4000);
      this.child.on('exit', () => {
        clearTimeout(t);
        r();
      });
    });
  }
}

/** Open one connection per database name. `kind`: 'app' (TCP as the app superuser) | 'maint' (psql socket as the maintenance role). */
export async function openMany(names, factory) {
  const dbs = {};
  try {
    for (const [key, name] of Object.entries(names)) dbs[key] = await factory(name);
  } catch (e) {
    await closeMany(dbs);
    throw e;
  }
  return dbs;
}
export async function closeMany(dbs) {
  await Promise.all(Object.values(dbs).map((d) => d.close().catch(() => {})));
}

export function tcpFactory(profile, { readOnly = true } = {}) {
  return async (database) => new TcpDb({ host: profile.host, port: profile.port, user: profile.appUser, password: profile.appPassword, database, readOnly }).connect();
}
export function maintFactory(profile, password, user) {
  return async (database) => new PsqlDb({ container: profile.container, user: user || 'gymini_maintenance', password, database }).connect();
}
