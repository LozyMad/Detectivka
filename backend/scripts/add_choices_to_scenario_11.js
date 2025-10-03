#!/usr/bin/env node

/**
 * Скрипт для добавления вариантов выбора в сценарий 11
 * Запуск: node backend/scripts/add_choices_to_scenario_11.js
 */

const db = require('../config/scenarioDatabase');

async function addChoicesToScenario11() {
    console.log('Добавление вариантов выбора в сценарий 11...');
    
    const scenarioDb = db.getScenarioDb(11);
    
    const choices = [
        {
            address_id: 8,
            choice_text: "Спросить у Джоша о подозреваемом",
            response_text: "Джош нехотя рассказывает, что видел подозреваемого вчера вечером в баре. Он говорит, что тот был очень нервным и постоянно оглядывался.",
            choice_order: 1
        },
        {
            address_id: 8,
            choice_text: "Попытаться войти в заведение",
            response_text: "Охранник категорически не пускает вас внутрь, говоря что у вас неподходящий внешний вид для этого заведения.",
            choice_order: 2
        },
        {
            address_id: 8,
            choice_text: "Уйти и попробовать другой подход",
            response_text: "Вы решаете отступить и подумать о других способах получения информации. Возможно, стоит попробовать другой адрес.",
            choice_order: 3
        }
    ];

    // Проверяем, есть ли уже выборы для адреса 8
    const existingChoices = await new Promise((resolve, reject) => {
        scenarioDb.all('SELECT * FROM address_choices WHERE address_id = 8', (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });

    if (existingChoices.length > 0) {
        console.log(`Найдено ${existingChoices.length} существующих выборов для адреса 8. Пропускаем добавление.`);
        return;
    }

    // Добавляем выборы
    for (let i = 0; i < choices.length; i++) {
        const choice = choices[i];
        await new Promise((resolve, reject) => {
            scenarioDb.run(
                'INSERT INTO address_choices (address_id, choice_text, response_text, choice_order, is_active) VALUES (?, ?, ?, ?, 1)',
                [choice.address_id, choice.choice_text, choice.response_text, choice.choice_order],
                (err) => {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });
        console.log(`Добавлен выбор ${i + 1}: "${choice.choice_text}"`);
    }

    // Проверяем результат
    const finalChoices = await new Promise((resolve, reject) => {
        scenarioDb.all('SELECT * FROM address_choices WHERE address_id = 8', (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });

    console.log(`\nУспешно добавлено ${finalChoices.length} вариантов выбора для адреса 8 в сценарии 11.`);
    console.log('Теперь диалоговые окна должны появляться при посещении этого адреса.');
}

// Запускаем скрипт
addChoicesToScenario11().catch(console.error);
