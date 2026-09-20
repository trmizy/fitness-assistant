async (page) => {
  await page.evaluate(async () => {
    const ReactModule = await import('/node_modules/.vite/deps/react.js');
    const React = ReactModule.default ?? ReactModule;
    const ReactDom = await import('/node_modules/.vite/deps/react-dom_client.js');
    const createRoot = ReactDom.createRoot ?? ReactDom.default.createRoot;
    const { FitnessAgentBlock } = await import('/src/app/components/agent/FitnessAgentBlocks.tsx');
    document.getElementById('root').style.display = 'none';
    document.getElementById('codex-preview-fixture')?.remove();
    const host = document.createElement('div');
    host.id = 'codex-preview-fixture';
    host.style.cssText = 'padding:16px;background:#18181b;color:#fafafa;min-height:100vh;width:100%;box-sizing:border-box';
    document.body.appendChild(host);
    const base = { risk:'MEDIUM', actionId:'isolated-fixture-no-write', expiresAt:'2099-01-01T00:00:00Z', note:'Xác nhận sẽ lưu lịch tập này vào hệ thống, thay thế lịch chưa hoàn thành hiện tại.', warnings:['Bạn đã báo cáo chấn thương. Hãy tham khảo ý kiến chuyên gia trước khi tăng cường độ tập.'] };
    const workout = {...base,type:'WORKOUT_PLAN_PREVIEW',daysPerWeek:3,sessionMinutes:60,goal:'WEIGHT_LOSS',days:[{day:'Thứ hai',goal:'Toàn thân',exercises:[{name:'Bulgarian Split Squat with Dumbbells and Controlled Eccentric Tempo',sets:4,reps:'10 mỗi bên',restSeconds:90}]}]};
    const nutrition = {...base,type:'NUTRITION_PLAN_PREVIEW',dailyCaloriesTarget:2200,mealsPerDay:4,proteinTargetGrams:165,carbTargetGrams:248,fatTargetGrams:61,nutritionDays:[{dayNumber:1,title:'Ngày thứ nhất',totalCalories:2200,meals:[{title:'Bữa sáng',calories:550,items:[{name:'Ức gà nướng với cơm gạo lứt, rau xanh và nước sốt thảo mộc',quantity:150,unit:'g',calories:350}]}]}]};
    createRoot(host).render(React.createElement(React.Fragment,null,...[workout,nutrition].map((block,i)=>React.createElement(FitnessAgentBlock,{key:i,block,onReply:()=>{}}))));
  });
  await page.locator('#codex-preview-fixture section').last().waitFor();
  const results=[];
  for(const width of [360,375,390,412]) {
    await page.setViewportSize({width,height:900});
    await page.locator('#codex-preview-fixture details').evaluateAll(nodes=>nodes.forEach(n=>n.open=true));
    results.push(await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,buttons:[...document.querySelectorAll('#codex-preview-fixture button')].map(b=>({text:b.textContent,width:b.getBoundingClientRect().width,height:b.getBoundingClientRect().height})),overflow:[...document.querySelectorAll('#codex-preview-fixture *')].filter(e=>e.getBoundingClientRect().right>innerWidth+1).length})));
    await page.screenshot({path:`output/playwright/codex-product-${width}.png`,fullPage:true});
  }
  await page.getByRole('button',{name:'Để sau',exact:true}).first().click();
  results.push({deferLabel:await page.locator('#codex-preview-fixture section').first().locator('button').first().textContent()});
  return results;
}
