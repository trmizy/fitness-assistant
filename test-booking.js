const http = require('http');

function request(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (data) headers['Content-Length'] = Buffer.byteLength(data);

    const req = http.request({ hostname: 'localhost', port: 3000, path, method, headers }, res => {
      let b = '';
      res.on('data', c => b += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(b) }); }
        catch { resolve({ status: res.statusCode, data: b }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function main() {
  console.log('=== Testing Booking System ===\n');

  // 1. Login as client
  console.log('1. Login as client...');
  const loginRes = await request('POST', '/auth/login', { email: 'test@example.com', password: 'Test123!' });
  if (loginRes.status !== 200) {
    console.log('  Login failed:', loginRes.status, loginRes.data);
    // Try registering
    console.log('  Trying to register...');
    const regRes = await request('POST', '/auth/register', { email: 'client1@test.com', password: 'Test123!', firstName: 'Client', lastName: 'One' });
    console.log('  Register:', regRes.status, JSON.stringify(regRes.data).slice(0, 200));
    if (regRes.status !== 201 && regRes.status !== 200) {
      console.log('  Cannot register or login. Aborting.');
      return;
    }
    var clientToken = regRes.data.accessToken;
    var clientId = regRes.data.user?.id;
  } else {
    var clientToken = loginRes.data.accessToken;
    var clientId = loginRes.data.user?.id;
  }
  console.log('  Client ID:', clientId);

  // 2. Test notifications endpoint
  console.log('\n2. Test notifications...');
  const notifRes = await request('GET', '/notifications?page=1&limit=5', null, clientToken);
  console.log('  Notifications:', notifRes.status, Array.isArray(notifRes.data?.notifications) ? `${notifRes.data.notifications.length} items` : JSON.stringify(notifRes.data).slice(0, 100));

  // 3. Test sessions/upcoming
  console.log('\n3. Test sessions/upcoming...');
  const upRes = await request('GET', '/sessions/upcoming', null, clientToken);
  console.log('  Upcoming:', upRes.status, Array.isArray(upRes.data) ? `${upRes.data.length} sessions` : JSON.stringify(upRes.data).slice(0, 100));

  // 4. Test contracts/client
  console.log('\n4. Test contracts (client)...');
  const contractRes = await request('GET', '/contracts/client', null, clientToken);
  console.log('  Contracts:', contractRes.status, Array.isArray(contractRes.data) ? `${contractRes.data.length} contracts` : JSON.stringify(contractRes.data).slice(0, 100));

  // 5. Test availability endpoint
  console.log('\n5. Test availability/me...');
  const availRes = await request('GET', '/availability/me', null, clientToken);
  console.log('  Availability:', availRes.status, Array.isArray(availRes.data) ? `${availRes.data.length} slots` : JSON.stringify(availRes.data).slice(0, 100));

  // 6. Login/register as PT
  console.log('\n6. Login as PT...');
  let ptLoginRes = await request('POST', '/auth/login', { email: 'pt1@test.com', password: 'Test123!' });
  if (ptLoginRes.status !== 200) {
    console.log('  PT login failed, registering...');
    const ptRegRes = await request('POST', '/auth/register', { email: 'pt1@test.com', password: 'Test123!', firstName: 'Trainer', lastName: 'One' });
    console.log('  PT register:', ptRegRes.status);
    ptLoginRes = { status: ptRegRes.status, data: ptRegRes.data };
  }
  const ptToken = ptLoginRes.data?.accessToken;
  const ptId = ptLoginRes.data?.user?.id;
  console.log('  PT ID:', ptId);

  if (!ptToken) {
    console.log('  No PT token. Aborting PT tests.');
    return;
  }

  // 7. PT sets availability
  console.log('\n7. PT sets availability...');
  const setAvailRes = await request('PUT', '/availability/me', {
    slots: [
      { dayOfWeek: 'MONDAY', startTime: '09:00', endTime: '17:00' },
      { dayOfWeek: 'WEDNESDAY', startTime: '09:00', endTime: '17:00' },
      { dayOfWeek: 'FRIDAY', startTime: '10:00', endTime: '18:00' },
    ]
  }, ptToken);
  console.log('  Set availability:', setAvailRes.status, Array.isArray(setAvailRes.data) ? `${setAvailRes.data.length} slots saved` : JSON.stringify(setAvailRes.data).slice(0, 100));

  // 8. Get PT availability (public)
  console.log('\n8. Get PT availability (public)...');
  if (ptId) {
    const pubAvailRes = await request('GET', `/availability/${ptId}`, null, clientToken);
    console.log('  Public availability:', pubAvailRes.status, Array.isArray(pubAvailRes.data) ? `${pubAvailRes.data.length} slots` : JSON.stringify(pubAvailRes.data).slice(0, 100));
  }

  // 9. Get available slots for a specific date
  console.log('\n9. Get available slots for date...');
  if (ptId) {
    const slotsRes = await request('GET', `/availability/${ptId}/slots?date=2026-03-25`, null, clientToken);
    console.log('  Available slots (Wed):', slotsRes.status, JSON.stringify(slotsRes.data).slice(0, 200));
  }

  // 10. PT adds a blocked date
  console.log('\n10. PT blocks a date...');
  const blockRes = await request('POST', '/availability/me/exceptions', { date: '2026-03-27', reason: 'Day off' }, ptToken);
  console.log('  Block date:', blockRes.status, JSON.stringify(blockRes.data).slice(0, 150));

  // 11. Get PT exceptions
  console.log('\n11. PT exceptions...');
  const excRes = await request('GET', '/availability/me/exceptions', null, ptToken);
  console.log('  Exceptions:', excRes.status, Array.isArray(excRes.data) ? `${excRes.data.length} exceptions` : JSON.stringify(excRes.data).slice(0, 100));

  // 12. Test notification unread count
  console.log('\n12. Notification unread count...');
  const unreadRes = await request('GET', '/notifications/unread-count', null, clientToken);
  console.log('  Unread:', unreadRes.status, JSON.stringify(unreadRes.data).slice(0, 100));

  // 13. PT contracts
  console.log('\n13. PT contracts...');
  const ptContractRes = await request('GET', '/contracts/pt', null, ptToken);
  console.log('  PT Contracts:', ptContractRes.status, Array.isArray(ptContractRes.data) ? `${ptContractRes.data.length} contracts` : JSON.stringify(ptContractRes.data).slice(0, 100));

  console.log('\n=== All tests complete ===');
}

main().catch(err => console.error('Test error:', err));
