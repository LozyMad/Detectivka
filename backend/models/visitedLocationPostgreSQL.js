const { queryScenario } = require('../config/scenarioPostgreSQL');

// Model for visited locations history (successful finds)
const VisitedLocation = {
  // Idempotently mark an address as visited by a user within a scenario
  visitLocation: async (userId, scenarioId, addressId, roomId = null) => {
    try {
      // Проверяем, не посещал ли уже пользователь эту локацию
      const existingResult = await queryScenario(
        scenarioId,
        `SELECT * FROM scenario_${scenarioId}.visited_locations 
         WHERE user_id = $1 AND address_id = $2 ${roomId !== null ? 'AND room_id = $3' : ''}
         ORDER BY visited_at DESC LIMIT 1`,
        roomId !== null ? [userId, addressId, roomId] : [userId, addressId]
      );
      
      if (existingResult.rows.length > 0) {
        return { alreadyVisited: true, visit: existingResult.rows[0] };
      }
      
      // Создаем новую запись о посещении
      const insertResult = await queryScenario(
        scenarioId,
        `INSERT INTO scenario_${scenarioId}.visited_locations (user_id, room_id, address_id) 
         VALUES ($1, $2, $3) RETURNING *`,
        [userId, roomId, addressId]
      );
      
      // Получаем полную информацию о посещении с данными адреса
      const visitResult = await queryScenario(
        scenarioId,
        `SELECT vl.*, a.district, a.house_number, a.description 
         FROM scenario_${scenarioId}.visited_locations vl
         LEFT JOIN scenario_${scenarioId}.addresses a ON vl.address_id = a.id
         WHERE vl.id = $1`,
        [insertResult.rows[0].id]
      );
      
      return { alreadyVisited: false, visit: visitResult.rows[0] };
    } catch (error) {
      console.error('Error visiting location:', error);
      throw error;
    }
  },

  // Get visited locations for user in active scenario
  getVisitedLocations: async (userId, scenarioId, roomId = null) => {
    try {
      const result = await queryScenario(
        scenarioId,
        `SELECT vl.id, vl.visited_at, a.district, a.house_number, a.description
         FROM scenario_${scenarioId}.visited_locations vl
         LEFT JOIN scenario_${scenarioId}.addresses a ON vl.address_id = a.id
         WHERE vl.user_id = $1 ${roomId !== null ? 'AND vl.room_id = $2' : ''}
         ORDER BY vl.visited_at DESC
         LIMIT 200`,
        roomId !== null ? [userId, roomId] : [userId]
      );
      
      return result.rows;
    } catch (error) {
      console.error('Error getting visited locations:', error);
      throw error;
    }
  },

  // Получить все посещенные локации (для экспорта)
  getAll: async () => {
    // Этот метод может быть сложным для реализации в PostgreSQL
    // так как данные хранятся в разных схемах
    // Пока возвращаем пустой массив
    return [];
  }
};

module.exports = VisitedLocation;
