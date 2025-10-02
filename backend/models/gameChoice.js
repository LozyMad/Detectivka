const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const GameChoice = sequelize.define('GameChoice', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    room_user_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
            model: 'room_users',
            key: 'id'
        },
        onDelete: 'CASCADE'
    },
    scenario_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        comment: 'ID сценария для связи с address_choices'
    },
    address_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        comment: 'ID адреса в сценарии'
    },
    choice_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        comment: 'ID выбора в таблице address_choices сценария'
    },
    choice_text: {
        type: DataTypes.TEXT,
        allowNull: false,
        comment: 'Копия текста выбора для истории'
    },
    response_text: {
        type: DataTypes.TEXT,
        allowNull: false,
        comment: 'Копия ответа для истории'
    },
    visited_location_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
            model: 'visited_locations',
            key: 'id'
        },
        onDelete: 'SET NULL',
        comment: 'Связь с посещенной локацией'
    }
}, {
    tableName: 'game_choices',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
        {
            fields: ['room_user_id']
        },
        {
            fields: ['scenario_id', 'address_id']
        },
        {
            fields: ['visited_location_id']
        },
        {
            unique: true,
            fields: ['room_user_id', 'scenario_id', 'address_id'],
            name: 'unique_player_scenario_address_choice'
        }
    ]
});

module.exports = GameChoice;
