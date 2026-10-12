const {query} = require('../config/database');
const Scenario = require('../models/scenario');
const Address = require('../models/address');
const Question = require('../models/question');
async function seedCatalog(){
  const rows=(await query('SELECT id,name,created_by FROM scenarios ORDER BY id')).rows;
  // Publish only the named case already advertised on the public site.
  // Keep all other organizer drafts private and preserve existing product settings.
  const upsert=async p=>query(`INSERT INTO player_products (id,scenario_id,title,description,cover,price,duration_seconds,difficulty,max_attempts,published,rubric,solution) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,1,$10,$11) ON CONFLICT(id) DO NOTHING`,p);
  const main=rows.find(s=>s.name==='Ставка на молчание');
  if(main)await upsert(['silence',main.id,main.name,'Журналистка Вероника Гронская найдена мёртвой. Милиция уверена: это самоубийство. Её расследование осталось незавершённым.','/assets/landing/silence-case-cover-v1.webp',2000,7200,3,3,null,null]);
  await query("UPDATE player_products SET duration_seconds=7200 WHERE id='first-case' AND duration_seconds=1800");
  if(process.env.PLAYER_LOCAL_MODE!=='1'||process.env.NODE_ENV==='production')return;
  const author=(await query("SELECT id FROM users WHERE admin_level='super_admin' ORDER BY id")).rows[0];
  if(!author)return;
  let demo=rows.find(s=>s.name==='Первое дело: пропавший конверт');
  if(!demo)demo=await Scenario.create({name:'Первое дело: пропавший конверт',description:'Учебное дело для локальной проверки кабинета',created_by:author.id});
  const addresses=await Address.getByScenario(demo.id);
  const scenes=[
    ['901','Архив. Анна Лебедева сообщает: из запертого шкафа пропал конверт с планом реставрации. В журнале выдачи ключей записаны Анна Лебедева и Илья Морозов. Анна весь вечер работала у охраны. Посетите охрану: Ц902.'],
    ['902','Охрана. На записи камеры Анна Лебедева сидит у поста с 18:00 до 19:00. Илья Морозов выходит из архива в 18:20 с плотным конвертом. Он направляется в мастерскую Ц903.'],
    ['903','Мастерская. Илья Морозов признаётся: он забрал конверт, чтобы раньше срока начать реставрацию. Конверт лежит в ячейке 17 в хранилище Ц904. Анна Лебедева о переносе документов не знала.'],
    ['904','Хранилище. В ячейке 17 лежит пропавший конверт. Подпись на нём — Анна Лебедева. Документы целы. Теперь ответьте на вопросы: кто забрал конверт, кто сообщил о пропаже и номер ячейки.']
  ];
  for(const [number,description]of scenes)if(!addresses.some(a=>a.district==='Ц'&&a.house_number===number))await Address.create({scenario_id:demo.id,district:'Ц',house_number:number,description});
  let questions=await Question.getByScenario(demo.id);
  const texts=['Кто забрал конверт? Укажите имя и фамилию.','Кто сообщил о пропаже? Укажите имя и фамилию.','В какой ячейке нашли конверт? Укажите число.'];
  for(let i=0;i<texts.length;i++)if(!questions.some(q=>q.question_text===texts[i]))await Question.create({scenario_id:demo.id,question_text:texts[i],question_order:i+1});
  questions=await Question.getByScenario(demo.id);
  const expected=[['Илья Морозов','Морозов'],['Анна Лебедева','Лебедева'],['17','ячейка 17']];
  const rubric=texts.map((text,i)=>({question_id:questions.find(q=>q.question_text===text).id,answers:expected[i]}));
  await upsert(['first-case',demo.id,'Первое дело: пропавший конверт','Из городского архива исчез конверт. Разберитесь, что случилось, познакомьтесь с поездками и ответами. Начните с архива по адресу Ц901, затем следуйте за уликами.','/assets/landing/detectum-upcoming-cover-v1.webp',0,7200,1,3,JSON.stringify(rubric),'Конверт забрал Илья Морозов: это подтверждают запись охраны и его признание. О пропаже сообщила Анна Лебедева; запись камеры исключает её участие. Конверт найден в ячейке 17. За каждый правильный ответ начисляется треть от 2000 баллов.']);

}
module.exports={seedCatalog};
