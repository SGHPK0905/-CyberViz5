module.exports = function handler(_request, response) {
  response.status(200).json({ status: 'ok', service: 'fraud-dashboard' });
};
