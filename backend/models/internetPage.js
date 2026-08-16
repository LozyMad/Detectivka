const DB_TYPE = process.env.DB_TYPE || 'sqlite';

let InternetPage;

if (DB_TYPE === 'postgresql') {
  InternetPage = require('./internetPagePostgreSQL');
} else {
  const { getScenarioDb } = require('../config/scenarioDatabase');

  InternetPage = {
    create: (scenario_id, pageData) => {
      return new Promise((resolve, reject) => {
        const {
          title,
          content_html,
          unlock_address_id,
          cafe_address_id,
          page_order = 1,
          is_active = true
        } = pageData;
        const db = getScenarioDb(scenario_id);

        db.run(
          `INSERT INTO internet_pages
           (title, content_html, unlock_address_id, cafe_address_id, page_order, is_active)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            title,
            content_html,
            unlock_address_id,
            cafe_address_id,
            page_order || 1,
            is_active === false ? 0 : 1
          ],
          function (err) {
            if (err) reject(err);
            else {
              resolve({
                id: this.lastID,
                title,
                content_html,
                unlock_address_id,
                cafe_address_id,
                page_order: page_order || 1,
                is_active: is_active !== false
              });
            }
          }
        );
      });
    },

    getByScenario: (scenario_id) => {
      return new Promise((resolve, reject) => {
        const db = getScenarioDb(scenario_id);
        db.all(
          `SELECT p.*,
                  ca.district AS cafe_district, ca.house_number AS cafe_house_number, ca.apartment AS cafe_apartment,
                  ua.district AS unlock_district, ua.house_number AS unlock_house_number, ua.apartment AS unlock_apartment
           FROM internet_pages p
           LEFT JOIN addresses ca ON p.cafe_address_id = ca.id
           LEFT JOIN addresses ua ON p.unlock_address_id = ua.id
           ORDER BY p.page_order, p.id`,
          [],
          (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
          }
        );
      });
    },

    getById: (scenario_id, id) => {
      return new Promise((resolve, reject) => {
        const db = getScenarioDb(scenario_id);
        db.get(`SELECT * FROM internet_pages WHERE id = ?`, [id], (err, row) => {
          if (err) reject(err);
          else resolve(row || null);
        });
      });
    },

    getActiveByCafe: (scenario_id, cafe_address_id) => {
      return new Promise((resolve, reject) => {
        const db = getScenarioDb(scenario_id);
        db.all(
          `SELECT id, title, unlock_address_id, cafe_address_id, page_order
           FROM internet_pages
           WHERE cafe_address_id = ? AND is_active = 1
           ORDER BY page_order, id`,
          [cafe_address_id],
          (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
          }
        );
      });
    },

    update: (scenario_id, id, pageData) => {
      return new Promise((resolve, reject) => {
        const {
          title,
          content_html,
          unlock_address_id,
          cafe_address_id,
          page_order,
          is_active
        } = pageData;
        const db = getScenarioDb(scenario_id);

        db.run(
          `UPDATE internet_pages
           SET title = ?, content_html = ?, unlock_address_id = ?, cafe_address_id = ?,
               page_order = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [
            title,
            content_html,
            unlock_address_id,
            cafe_address_id,
            page_order || 1,
            is_active === false ? 0 : 1,
            id
          ],
          function (err) {
            if (err) reject(err);
            else resolve({ id, changes: this.changes });
          }
        );
      });
    },

    delete: (scenario_id, id) => {
      return new Promise((resolve, reject) => {
        const db = getScenarioDb(scenario_id);
        db.run(`DELETE FROM internet_pages WHERE id = ?`, [id], function (err) {
          if (err) reject(err);
          else resolve({ deletedId: id, changes: this.changes });
        });
      });
    },

    hasVisitedAddress: (scenario_id, user_id, address_id, room_id = null) => {
      return new Promise((resolve, reject) => {
        const db = getScenarioDb(scenario_id);
        const sql =
          room_id != null
            ? `SELECT id FROM visited_locations WHERE user_id = ? AND address_id = ? AND room_id = ? LIMIT 1`
            : `SELECT id FROM visited_locations WHERE user_id = ? AND address_id = ? LIMIT 1`;
        const params =
          room_id != null ? [user_id, address_id, room_id] : [user_id, address_id];

        db.get(sql, params, (err, row) => {
          if (err) reject(err);
          else resolve(!!row);
        });
      });
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
}

module.exports = InternetPage;
