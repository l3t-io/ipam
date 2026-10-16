'use strict';

// Simulated UniFi controller: Integration API with X-API-KEY, classic API for reservations.

const http = require('node:http');
const https = require('node:https');

// zonen: 'integration' (v1 with the same network IDs), 'klassisch' (v2 with its own IDs) or 'keine'
// netzeOhneSubnetz: Integration API returns networks without a subnet (then the classic ones count,
// whose IDs do not match the zones)
// tls: { key, cert } starts the controller over HTTPS; port: fixed port instead of a random one
function startFakeUnifi({ key = 'richtiger-schluessel-1234', reservations = [], zonen = 'integration', netzeOhneSubnetz = false, tls = null, port = 0 } = {}) {
  const seenKeys = [];
  const routes = {
    '/proxy/network/integration/v1/info': { applicationVersion: '9.4.19' },
    '/proxy/network/integration/v1/sites': { data: [{ id: 's1', internalReference: 'default', name: 'Default' }] },
    '/proxy/network/integration/v1/sites/s1/networks': {
      data: [netzeOhneSubnetz ? { id: 'n-server', name: 'Server', vlanId: 20 } : { id: 'n-server', name: 'Server', vlanId: 20, ipSubnet: '10.13.20.1/24' }],
    },
    '/proxy/network/integration/v1/sites/s1/devices': {
      data: [{ ipAddress: '10.13.20.2', macAddress: 'AA:BB:CC:00:00:02', name: 'switch', model: 'USW-Lite-8' }],
    },
    '/proxy/network/integration/v1/sites/s1/clients': { data: [{ ipAddress: '10.13.20.50', macAddress: 'aa:bb:cc:00:00:50', name: 'laptop' }] },
    '/proxy/network/api/s/default/rest/user': { data: reservations },
    '/proxy/network/api/s/default/rest/networkconf': {
      data: [{ _id: '64f0aa000000000000000020', name: 'Server', vlan: 20, ip_subnet: '10.13.20.1/24', purpose: 'corporate' }],
    },
  };
  if (zonen === 'integration') {
    routes['/proxy/network/integration/v1/sites/s1/firewall/zones'] = {
      data: [
        { id: 'z-int', name: 'Internal', networkIds: ['n-server'], metadata: { origin: 'SYSTEM_DEFINED' } },
        { id: 'z-ext', name: 'External', networkIds: [], metadata: { origin: 'SYSTEM_DEFINED' } },
      ],
    };
  }
  if (zonen === 'klassisch') {
    routes['/proxy/network/v2/api/site/default/firewall/zone'] = [
      { _id: 'z1', name: 'DMZ', network_ids: ['64f0aa000000000000000020'], default_zone: false },
    ];
  }

  const handler = (req, res) => {
    const given = req.headers['x-api-key'] || '';
    seenKeys.push(given);
    if (given !== key) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end('{"error":"unauthorized"}');
    }
    const body = routes[new URL(req.url, 'http://x').pathname];
    res.writeHead(body ? 200 : 404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body || { error: 'not found' }));
  };
  const server = tls ? https.createServer(tls, handler) : http.createServer(handler);

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      resolve({
        url: `${tls ? 'https' : 'http'}://127.0.0.1:${server.address().port}`,
        // Swap the certificate while running (simulates an attacker in the middle)
        zertifikatTauschen: (neu) => server.setSecureContext(neu),
        key,
        seenKeys,
        stop: () => { if (server.closeAllConnections) server.closeAllConnections(); return new Promise((r) => server.close(r)); },
      });
    });
  });
}

module.exports = { startFakeUnifi };
