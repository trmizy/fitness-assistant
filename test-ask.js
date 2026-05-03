
async function test() {
  console.time('ResponseTime');
  try {
    const res = await fetch('http://localhost:3003/ai/ask', {
      method: 'POST',
      body: JSON.stringify({ question: 'Chào PT, tôi cao 1m7 n?ng 80kg, làm sao d? gi?m cân?' }),
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': 'e2e-test-user',
        'x-internal-token': 'dev_internal_service_secret_change_in_production'
      }
    });
    const data = await res.json();
    console.timeEnd('ResponseTime');
    console.log(JSON.stringify(data, null, 2));
  } catch (err) {
    console.timeEnd('ResponseTime');
    console.error(err);
  }
}
test();

