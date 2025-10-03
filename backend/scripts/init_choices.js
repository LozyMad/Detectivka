#!/usr/bin/env node

/**
 * Скрипт для инициализации вариантов выбора при запуске сервера
 * Этот файл будет автоматически создавать выборы, если их нет
 */

const db = require('../config/scenarioDatabase');

async function initializeChoices() {
    console.log('Проверка и инициализация вариантов выбора...');
    
    try {
        const scenarioDb = db.getScenarioDb(11);
        
        // Проверяем, есть ли выборы для адреса 8
        const existingChoices = await new Promise((resolve, reject) => {
            scenarioDb.all('SELECT * FROM address_choices WHERE address_id = 8', (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });

        if (existingChoices.length > 0) {
            console.log(`Найдено ${existingChoices.length} выборов для адреса 8. Инициализация не требуется.`);
            return;
        }

        console.log('Создание вариантов выбора для адреса 8...');

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
            console.log(`Создан выбор ${i + 1}: "${choice.choice_text}"`);
        }

        console.log('✅ Варианты выбора успешно инициализированы!');
        
    } catch (error) {
        console.error('❌ Ошибка при инициализации выборов:', error);
    }
}

module.exports = { initializeChoices };
