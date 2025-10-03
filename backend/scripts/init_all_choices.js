#!/usr/bin/env node

/**
 * Радикальное решение: создаем выборы для ВСЕХ адресов во ВСЕХ активных сценариях
 */

const db = require('../config/scenarioDatabase');

async function initializeAllChoices() {
    console.log('🚀 РАДИКАЛЬНАЯ ИНИЦИАЛИЗАЦИЯ: Создание выборов для всех адресов во ВСЕХ сценариях...');
    
    try {
        // Получаем все активные сценарии
        const { query } = require('../config/database');
        const scenariosResult = await query('SELECT * FROM scenarios WHERE is_active = 1');
        const activeScenarios = scenariosResult.rows;
        
        console.log(`📋 Найдено ${activeScenarios.length} активных сценариев:`, activeScenarios.map(s => `${s.id} (${s.name})`));
        
        for (const scenario of activeScenarios) {
            console.log(`\n🎯 Обрабатываем сценарий ${scenario.id} (${scenario.name})`);
            
            // Получаем адреса для этого сценария
            const addressesResult = await query('SELECT * FROM addresses WHERE scenario_id = ?', [scenario.id]);
            const addresses = addressesResult.rows;
            
            console.log(`📋 Найдено ${addresses.length} адресов в сценарии ${scenario.id}`);
            
            if (addresses.length === 0) {
                console.log(`⚠️ Нет адресов в сценарии ${scenario.id}, пропускаем`);
                continue;
            }
            
            const scenarioDb = db.getScenarioDb(scenario.id);
            
            for (const address of addresses) {
                console.log(`🏠 Обрабатываем адрес: ${address.district}-${address.house_number} (ID: ${address.id})`);
                
                // Проверяем, есть ли уже выборы для этого адреса
                const existingChoices = await new Promise((resolve, reject) => {
                    scenarioDb.all('SELECT * FROM address_choices WHERE address_id = ?', [address.id], (err, rows) => {
                        if (err) reject(err);
                        else resolve(rows);
                    });
                });
                
                if (existingChoices.length > 0) {
                    console.log(`  ✅ Уже есть ${existingChoices.length} выборов, пропускаем`);
                    continue;
                }
                
                // Создаем выборы для каждого адреса
                const choices = [
                    {
                        address_id: address.id,
                        choice_text: "Исследовать место подробнее",
                        response_text: `Вы внимательно осматриваете ${address.district} район, дом ${address.house_number}. ${address.description || 'Здесь есть что-то интересное...'}`,
                        choice_order: 1
                    },
                    {
                        address_id: address.id,
                        choice_text: "Спросить у прохожих",
                        response_text: `Вы расспрашиваете местных жителей о доме ${address.house_number}. Они рассказывают интересные детали о том, что здесь происходило.`,
                        choice_order: 2
                    },
                    {
                        address_id: address.id,
                        choice_text: "Попробовать другой подход",
                        response_text: `Вы решаете изменить тактику и попробовать другой способ получения информации об этом месте.`,
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
                    console.log(`  ➕ Добавлен выбор ${i + 1}: "${choice.choice_text}"`);
                }
            }
        }
        
        console.log(`\n🎉 РАДИКАЛЬНАЯ ИНИЦИАЛИЗАЦИЯ ЗАВЕРШЕНА!`);
        console.log(`✅ Теперь диалоговые окна должны появляться для ЛЮБОГО адреса в ЛЮБОМ активном сценарии!`);
        
    } catch (error) {
        console.error('❌ Ошибка при радикальной инициализации:', error);
    }
}

module.exports = { initializeAllChoices };

// Если скрипт запущен напрямую, выполняем инициализацию
if (require.main === module) {
    initializeAllChoices().catch(console.error);
}