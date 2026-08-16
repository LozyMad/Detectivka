const { queryScenario, ensureTables } = require('../config/scenarioPostgreSQL');

const InternetPage = {
  create: async (scenario_id, pageData) => {
    await ensureTables(scenario_id);
    const {
      title,
      content_html,
      unlock_address_id,
      cafe_address_id,
      page_order = 1,
      is_active = true
    } = pageData;

    const result = await queryScenario(
      scenario_id,
      `INSERT INTO scenario_${scenario_id}.internet_pages
       (title, content_html, unlock_address_id, cafe_address_id, page_order, is_active)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [title, content_html, unlock_address_id, cafe_address_id, page_order || 1, is_active !== false]
    );
    return result.rows[0];
  },

  getByScenario: async (scenario_id) => {
    await ensureTables(scenario_id);
    const result = await queryScenario(
      scenario_id,
      `SELECT p.*,
              ca.district AS cafe_district, ca.house_number AS cafe_house_number, ca.apartment AS cafe_apartment,
              ua.district AS unlock_district, ua.house_number AS unlock_house_number, ua.apartment AS unlock_apartment
       FROM scenario_${scenario_id}.internet_pages p
       LEFT JOIN scenario_${scenario_id}.addresses ca ON p.cafe_address_id = ca.id
       LEFT JOIN scenario_${scenario_id}.addresses ua ON p.unlock_address_id = ua.id
       ORDER BY p.page_order, p.id`
    );
    return result.rows;
  },

  getById: async (scenario_id, id) => {
    await ensureTables(scenario_id);
    const result = await queryScenario(
      scenario_id,
      `SELECT * FROM scenario_${scenario_id}.internet_pages WHERE id = $1`,
      [id]
    );
    return result.rows[0] || null;
  },

  getActiveByCafe: async (scenario_id, cafe_address_id) => {
    await ensureTables(scenario_id);
    const result = await queryScenario(
      scenario_id,
      `SELECT id, title, unlock_address_id, cafe_address_id, page_order
       FROM scenario_${scenario_id}.internet_pages
       WHERE cafe_address_id = $1 AND is_active = true
       ORDER BY page_order, id`,
      [cafe_address_id]
    );
    return result.rows;
  },

  update: async (scenario_id, id, pageData) => {
    const {
      title,
      content_html,
      unlock_address_id,
      cafe_address_id,
      page_order,
      is_active
    } = pageData;

    const result = await queryScenario(
      scenario_id,
      `UPDATE scenario_${scenario_id}.internet_pages
       SET title = $1, content_html = $2, unlock_address_id = $3, cafe_address_id = $4,
           page_order = $5, is_active = $6, updated_at = CURRENT_TIMESTAMP
       WHERE id = $7 RETURNING *`,
      [title, content_html, unlock_address_id, cafe_address_id, page_order || 1, is_active !== false, id]
    );
    return result.rows[0] || null;
  },

  delete: async (scenario_id, id) => {
    const result = await queryScenario(
      scenario_id,
      `DELETE FROM scenario_${scenario_id}.internet_pages WHERE id = $1 RETURNING *`,
      [id]
    );
    return result.rows[0] || null;
  },

  hasVisitedAddress: async (scenario_id, user_id, address_id, room_id = null) => {
    await ensureTables(scenario_id);
    const result = await queryScenario(
      scenario_id,
      room_id != null
        ? `SELECT id FROM scenario_${scenario_id}.visited_locations
           WHERE user_id = $1 AND address_id = $2 AND room_id = $3 LIMIT 1`
        : `SELECT id FROM scenario_${scenario_id}.visited_locations
           WHERE user_id = $1 AND address_id = $2 LIMIT 1`,
      room_id != null ? [user_id, address_id, room_id] : [user_id, address_id]
    );
    return result.rows.length > 0;
  },

  getUnlockedForPlayer: async (scenario_id, cafe_address_id, user_id, room_id = null) => {
    const pages = await InternetPage.getActiveByCafe(scenario_id, cafe_address_id);
    const unlocked = [];
    for (const page of pages) {
      const visited = await InternetPage.hasVisitedAddress(
        scenario_id,
        user_id,
        page.unlock_address_id,
        room_id
      );
      if (visited) {
        unlocked.push({ id: page.id, title: page.title, page_order: page.page_order });
      }
    }
    return unlocked;
  }
};

module.exports = InternetPage;
