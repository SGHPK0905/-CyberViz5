const dashboard = require('../data/dashboard.json');

module.exports = function handler(_request, response) {
  response.setHeader('Cache-Control', 'public, max-age=0, s-maxage=86400, stale-while-revalidate=604800');
  response.status(200).json(dashboard);
};
