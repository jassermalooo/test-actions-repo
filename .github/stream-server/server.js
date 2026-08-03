const http = require('http');
const WebSocket = require('ws');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const DIR = __dirname;

const httpServer = http.createServer((req, res) => {
  if (req.url === '/jsmpeg.min.js') {
    res.writeHead(200, {'Content-Type':'application/javascript'});
    res.end(fs.readFileSync(path.join(DIR, 'jsmpeg.min.js')));
  } else {
    res.writeHead(200, {'Content-Type':'text/html'});
    res.end(fs.readFileSync(path.join(DIR, 'player.html')));
  }
});
httpServer.listen(8080, '0.0.0.0', () => console.log('HTTP player: port 8080'));

const wss = new WebSocket.Server({ port: 8081 });
wss.on('connection', (ws) => {
  console.log('Client connected, starting H264/MPEG1 stream...');
  const ffmpeg = spawn('ffmpeg', [
    '-f', 'x11grab', '-r', '30', '-s', '720x1280', '-i', ':99',
    '-f', 'mpegts', '-codec:v', 'mpeg1video',
    '-b:v', '2000k', '-bf', '0', '-muxdelay', '0.001',
    'pipe:1'
  ], { stdio: ['ignore', 'pipe', 'ignore'] });

  ffmpeg.stdout.on('data', (data) => {
    if (ws.readyState === ws.OPEN) ws.send(data, { binary: true });
  });
  ws.on('close', () => { console.log('Client disconnected'); ffmpeg.kill('SIGKILL'); });
  ffmpeg.on('exit', (c) => console.log('ffmpeg exit:', c));
});
console.log('WebSocket stream: port 8081');
