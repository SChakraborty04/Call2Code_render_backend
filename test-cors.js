#!/usr/bin/env node

// Script to test CORS on the backend
const http = require('http');

const options = {
  hostname: 'localhost',
  port: 8787,
  path: '/api/game-score',
  method: 'OPTIONS',
  headers: {
    'Origin': 'http://localhost:8080',
    'Access-Control-Request-Method': 'POST',
    'Access-Control-Request-Headers': 'Content-Type'
  }
};

const req = http.request(options, (res) => {
  console.log('STATUS:', res.statusCode);
  console.log('HEADERS:', JSON.stringify(res.headers, null, 2));
  
  console.log('\nCORS Headers Check:');
  console.log('Access-Control-Allow-Origin:', res.headers['access-control-allow-origin'] || 'Not set');
  console.log('Access-Control-Allow-Methods:', res.headers['access-control-allow-methods'] || 'Not set');
  console.log('Access-Control-Allow-Headers:', res.headers['access-control-allow-headers'] || 'Not set');
  console.log('Access-Control-Allow-Credentials:', res.headers['access-control-allow-credentials'] || 'Not set');
  
  res.on('data', (chunk) => {
    console.log(`BODY: ${chunk}`);
  });
});

req.on('error', (e) => {
  console.error(`Problem with request: ${e.message}`);
});

req.end();
