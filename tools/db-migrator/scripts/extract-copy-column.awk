# extract-copy-column.awk
#
# Reads the plain-text output of `pg_restore -t <table> -f - <dump>` (a
# custom-format archive rendered as SQL text: a `COPY schema.table (col, ...)
# FROM stdin;` header, tab-separated data rows, terminated by `\.`) and
# prints one line per DISTINCT, non-NULL value found in the named column.
#
# This reads literal data straight out of the dump file — no guessing, no
# database connection, no risk to any target database. Column position is
# resolved from the COPY header itself (not assumed), so it's correct
# regardless of how a given dump orders its columns.
#
# Usage: pg_restore -t <table> -f - <dump> | awk -f extract-copy-column.awk -v col=<column_name>

BEGIN { in_copy = 0; col_idx = -1 }

/^COPY / && in_copy == 0 {
  line = $0
  start = index(line, "(")
  finish = index(line, ")")
  if (start == 0 || finish == 0) next
  collist = substr(line, start + 1, finish - start - 1)
  n = split(collist, cols, ",")
  col_idx = -1
  for (i = 1; i <= n; i++) {
    name = cols[i]
    gsub(/^[ \t"]+|[ \t"]+$/, "", name)
    if (name == col) col_idx = i
  }
  in_copy = 1
  next
}

in_copy == 1 && /^\\\.[[:space:]]*$/ { in_copy = 0; col_idx = -1; next }

in_copy == 1 {
  if (col_idx == -1) next
  n = split($0, fields, "\t")
  if (col_idx > n) next
  v = fields[col_idx]
  if (v == "\\N") next
  if (!(v in seen)) { seen[v] = 1; print v }
}
