const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const AddressChoice = sequelize.define('AddressChoice', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
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
    choice_text: {
        type: DataTypes.TEXT,
        allowNull: false,
        comment: 'Текст варианта выбора (например: "Открыть книгу")'
    },
    response_text: {
        type: DataTypes.TEXT,
        allowNull: false,
        comment: 'Ответ на выбор игрока (например: "Вы нашли карту сокровищ!")'
    },
    choice_order: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 1,
        comment: 'Порядок отображения вариантов (1, 2, 3...)'
    },
    is_active: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
        comment: 'Активен ли этот вариант выбора'
    }
}, {
    tableName: 'address_choices',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
        {
            fields: ['address_id']
        },
        {
            fields: ['address_id', 'choice_order']
        }
    ]
});

module.exports = AddressChoice;
