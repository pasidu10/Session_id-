// server.js
require('dotenv').config();
const fs = require('fs');
const http = require('http');
const path = require('path');
const express = require('express');
const WebSocket = require('ws');
const { default: makeWASocket, useSingleFileAuthState, fetchLatestBaileysVersion } = require('@adiwajshing/baileys');

const app = express();
const server = http.createServer(app);

// serve frontend (put frontend files into backend/public)
app.use(express.static(path.join(__dirname, 'public')));

// WebSocket upgrade on /ws
const wss = new WebSocket.Server({ noServer: true });
server.on('upgrade', function upgrade(request, socket, head) {
  if (request.url === '/ws') {
    wss.handleUpgrade(request, socket, head, function done(ws) {
      wss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

function broadcast(obj){
  const s = JSON.stringify(obj);
  wss.clients.forEach(c=>{ if(c.readyState===WebSocket.OPEN) c.send(s); });
}

const PORT = process.env.PORT || 3000;

(async ()=>{
  const authFile = path.join(__dirname, 'auth_info.json');
  const { state, saveState } = await useSingleFileAuthState(authFile);
  const { version } = await fetchLatestBaileysVersion();

  let sock = makeWASocket({ auth: state, version });

  sock.ev.on('creds.update', saveState);

  sock.ev.on('connection.update', (update) => {
    const { connection, qr, lastDisconnect } = update;
    if(qr){
      // Baileys gives qr string; for frontend we convert it to a data URI (basic approach)
      broadcast({ type:'qr', data: 'data:image/png;base64,' + Buffer.from(qr).toString('base64') });
      broadcast({ type:'status', data:'qr' });
    }
    if(connection === 'open'){
      broadcast({ type:'status', data:'open' });
      try{
        if(fs.existsSync(authFile)){
          const raw = fs.readFileSync(authFile,'utf8');
          let json;
          try{ json = JSON.parse(raw); }catch(e){ json = { raw }; }
          broadcast({ type:'session', data: json });
        }
      }catch(e){ console.error(e); }
    }
    if(lastDisconnect && lastDisconnect.error){
      console.log('disconnected', lastDisconnect.error);
      broadcast({ type:'status', data:'disconnected' });
      // attempt reconnect (re-init socket)
      try{ sock.end(); }catch(e){}
      sock = makeWASocket({ auth: state, version });
      sock.ev.on('creds.update', saveState);
    }
  });

  wss.on('connection', ws=>{
    ws.on('message', msg=>{
      try{
        const o = JSON.parse(msg.toString());
        if(o.action === 'refreshQR'){
          console.log('refresh requested');
          try{ sock.logout(); }catch(e){}
        }
      }catch(e){ }
    });
  });

  server.listen(PORT, ()=>console.log('Listening on', PORT));
})();
