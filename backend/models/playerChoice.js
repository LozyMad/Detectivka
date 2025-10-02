const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const PlayerChoice = sequelize.define('PlayerChoice', {
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
    address_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
            model: 'addresses',
            key: 'id'
        },
        onDelete: 'CASCADE'
    },
    choice_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
            model: 'address_choices',
            key: 'id'
        },
        onDelete: 'CASCADE'
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
    tableName: 'player_choices',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
        {
            fields: ['room_user_id']
        },
        {
            fields: ['address_id']
        },
        {
            fields: ['choice_id']
        },
        {
            fields: ['visited_location_id']
        },
        {
            unique: true,
            fields: ['room_user_id', 'address_id'],
            name: 'unique_player_address_choice'
        }
    ]
});

module.exports = PlayerChoice;
