'use strict';

// Comparison: outdated reservations versus what is actually online.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { diff, brueckenAufloesen } = require('../app/unifi');

const DMZ = { id: 'v-dmz', name: 'DMZ', vid: 80, cidr: '10.0.80.0/24', gateway: '10.0.80.1' };

const controller = ({ reservations = [], live = [] }) => ({
  networks: [{ name: 'DMZ', vid: 80, cidr: '10.0.80.0/24', gateway: '10.0.80.1', dhcpFrom: '', dhcpTo: '' }],
  devices: [], reservations, live,
  controller: 'https://10.1.1.1', version: '9.4', site: 'default', quellen: [], warnungen: [], at: '',
});

const altesGeraet = { ip: '10.0.80.10', mac: 'bc:24:11:00:00:23', name: 'old-vm', hostname: 'old-vm', dns: '', fixed: true };

test('different device on a reserved address: the one actually present is suggested', () => {
  const d = diff({ vlans: [DMZ], hosts: [] }, controller({
    reservations: [altesGeraet],
    live: [{ ip: '10.0.80.10', mac: 'bc:24:11:aa:bb:cc', name: 'PBX Server', hostname: 'pbx', dns: '', fixed: false }],
  }));
  assert.equal(d.hosts.length, 1);
  assert.equal(d.hosts[0].art, 'neu');
  assert.equal(d.hosts[0].unifi.name, 'PBX Server');
  assert.equal(d.hosts[0].unifi.mac, 'bc:24:11:aa:bb:cc');
  assert.equal(d.hosts[0].veraltet.name, 'old-vm');
  assert.equal(d.hosts[0].veraltet.mac, 'bc:24:11:00:00:23');
  assert.deepEqual(d.hosts[0].veraltet.aktuell, { mac: 'bc:24:11:aa:bb:cc', name: 'PBX Server', online: true });
  assert.equal(d.undokumentiert.length, 0, 'the same address not additionally as a live finding');
});

test('same device under a new name: the current name wins', () => {
  const d = diff({ vlans: [DMZ], hosts: [] }, controller({
    reservations: [altesGeraet],
    live: [{ ip: '10.0.80.10', mac: 'bc:24:11:00:00:23', name: 'PBX Server', hostname: 'pbx', dns: '', fixed: true }],
  }));
  assert.equal(d.hosts[0].unifi.name, 'PBX Server');
  assert.equal(d.hosts[0].veraltet, undefined);
});

test('reservation without a live finding stays as before', () => {
  const d = diff({ vlans: [DMZ], hosts: [] }, controller({ reservations: [altesGeraet] }));
  assert.equal(d.hosts[0].unifi.name, 'old-vm');
  assert.equal(d.hosts[0].veraltet, undefined);
});

test('documented host online: apply nothing, separate check notice showing both sides', () => {
  const host = { id: 'h1', vlanId: 'v-dmz', ip: '10.0.80.10', hostname: 'PBX Server', mac: 'bc:24:11:aa:bb:cc' };
  const d = diff({ vlans: [DMZ], hosts: [host] }, controller({
    reservations: [altesGeraet],
    live: [{ ip: '10.0.80.10', mac: 'bc:24:11:aa:bb:cc', name: 'PBX Server', hostname: '', dns: '', fixed: false }],
  }));
  assert.deepEqual(d.hosts, [], 'nothing listed under «Hosts with differences»');
  assert.equal(d.pruefen.length, 1);
  assert.equal(d.pruefen[0].veraltet.name, 'old-vm');
  assert.deepEqual(d.pruefen[0].eigen, { hostname: 'PBX Server', mac: 'bc:24:11:aa:bb:cc' });
});

test('new device currently offline: last seen decides, the old MAC is not written back', () => {
  const TAG = 86400000;
  const host = { id: 'h1', vlanId: 'v-dmz', ip: '10.0.80.15', hostname: 'Sonos Era', mac: '02:00:00:5a:0b:01' };
  const sonosAlt = { ip: '10.0.80.15', mac: '02:00:00:5a:0b:02', name: 'SonosZP', hostname: '', dns: '', fixed: true, lastSeen: Date.now() - 200 * TAG };
  const d = diff({ vlans: [DMZ], hosts: [host] }, {
    ...controller({ reservations: [sonosAlt] }),
    clients: [sonosAlt, { mac: '02:00:00:5a:0b:01', lastSeen: Date.now() - 1 * TAG }],
  });
  assert.deepEqual(d.hosts, [], 'no MAC correction to the old device');
  assert.equal(d.pruefen.length, 1);
  assert.equal(d.pruefen[0].veraltet.aktuell.online, false);
  assert.ok(d.pruefen[0].veraltet.lastSeen);
});

test('reservation is newer than the documentation: MAC correction as before', () => {
  const TAG = 86400000;
  const host = { id: 'h1', vlanId: 'v-dmz', ip: '10.0.80.15', hostname: 'Sonos', mac: '02:00:00:5a:0b:02' };
  const neu = { ip: '10.0.80.15', mac: '02:00:00:5a:0b:01', name: 'Sonos', hostname: '', dns: '', fixed: true, lastSeen: Date.now() - 1 * TAG };
  const d = diff({ vlans: [DMZ], hosts: [host] }, {
    ...controller({ reservations: [neu] }),
    clients: [neu, { mac: '02:00:00:5a:0b:02', lastSeen: Date.now() - 300 * TAG }],
  });
  assert.deepEqual(d.hosts[0].abweichungen.map((a) => [a.feld, a.unifi]), [['mac', '02:00:00:5a:0b:01']]);
  assert.deepEqual(d.pruefen, []);
});

// Sonos home theatre: sub and rears communicate wirelessly via the soundbar. UniFi shows
// their addresses behind the soundbar's MAC.
const SOUNDBAR = '02:00:00:5a:0b:01';
const REAR = '02:00:00:5a:0b:02';
const LAN = { id: 'v-lan', name: 'LAN', vid: 1, cidr: '10.0.42.0/24' };

test('bridge: addresses behind the soundbar get the actual device', () => {
  const rear = { ip: '10.0.42.15', mac: REAR, name: 'SonosZP', fixed: true, lastSeen: Date.now() - 13 * 60000 };
  const live = brueckenAufloesen(
    [{ ip: '10.0.42.13', mac: SOUNDBAR, name: 'Sonos Arc' }, { ip: '10.0.42.15', mac: SOUNDBAR, name: 'Sonos Arc' }],
    [rear],
  );
  assert.equal(live[1].mac, REAR);
  assert.equal(live[1].ueberBruecke, SOUNDBAR);
  assert.equal(live[0].mac, SOUNDBAR);
  assert.equal(live[0].bruecke, true);
});

test('Sonos: recently seen reservation is never outdated, wrong MAC is offered for correction', () => {
  const rear = { ip: '10.0.42.15', mac: REAR, name: 'SonosZP', hostname: '', dns: '', fixed: true, lastSeen: Date.now() - 13 * 60000 };
  const state = { vlans: [LAN], hosts: [
    { id: 'h13', vlanId: 'v-lan', ip: '10.0.42.13', hostname: 'Sonos Arc', mac: SOUNDBAR },
    { id: 'h15', vlanId: 'v-lan', ip: '10.0.42.15', hostname: 'Sonos Arc', mac: SOUNDBAR }, // wrongly applied earlier
  ] };
  // Without resolution (live shows the soundbar on .15) as with resolution: same result.
  for (const live of [
    [{ ip: '10.0.42.13', mac: SOUNDBAR }, { ip: '10.0.42.15', mac: SOUNDBAR }],
    brueckenAufloesen([{ ip: '10.0.42.13', mac: SOUNDBAR }, { ip: '10.0.42.15', mac: SOUNDBAR }], [rear]),
  ]) {
    const d = diff(state, { ...controller({ reservations: [rear], live }), clients: [rear, { mac: SOUNDBAR, lastSeen: Date.now() }] });
    assert.deepEqual(d.pruefen, [], 'no notice about an outdated reservation');
    const h = d.hosts.find((x) => x.ip === '10.0.42.15');
    assert.deepEqual(h.abweichungen.map((a) => [a.feld, a.ipam, a.unifi]), [['mac', SOUNDBAR, REAR]]);
  }
});

test('reservation in the controller: type «reserviert» is suggested, only for the same device', () => {
  const res = { ip: '10.0.80.20', mac: 'aa:bb:cc:00:00:20', name: 'drucker', hostname: '', dns: '', fixed: true, lastSeen: Date.now() };
  const base = { id: 'h', vlanId: 'v-dmz', ip: '10.0.80.20', hostname: 'drucker' };
  const typ = (host) => diff({ vlans: [DMZ], hosts: [host] }, controller({ reservations: [res] }))
    .hosts.flatMap((h) => h.abweichungen).filter((a) => a.feld === 'kind');

  assert.deepEqual(typ({ ...base, mac: res.mac, kind: 'statisch' }).map((a) => [a.ipam, a.unifi]), [['statisch', 'reserviert']]);
  assert.deepEqual(typ({ ...base, mac: res.mac, kind: 'dhcp' }).map((a) => [a.ipam, a.unifi]), [['dhcp', 'reserviert']]);
  assert.deepEqual(typ({ ...base, mac: res.mac, kind: 'reserviert' }), []);
  assert.deepEqual(typ({ ...base, mac: 'aa:bb:cc:99:99:99', kind: 'statisch' }), [], 'different device: leave the type alone');
});
