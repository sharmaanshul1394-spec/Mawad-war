import express from "express";
import http from "http";
import { Server } from "socket.io";

const app=express();

const server=
  http.createServer(app);

const io=
  new Server(server);

app.use(
  express.static("public")
);

/* =========================
   WEAPONS
========================= */

const WEAPONS={

  Pistol:{
    damage:25,
    range:30,
    magazineSize:12,
    reserveStart:60,
    fireDelay:350,
    reloadTime:900
  },

  Rifle:{
    damage:18,
    range:45,
    magazineSize:30,
    reserveStart:120,
    fireDelay:110,
    reloadTime:1300
  },

  Shotgun:{
    damage:15,
    pellets:6,
    range:18,
    magazineSize:6,
    reserveStart:36,
    fireDelay:800,
    reloadTime:1500
  }

};

const weaponList=[
  "Pistol",
  "Rifle",
  "Shotgun"
];

/* =========================
   GAME DATA
========================= */

const players=new Map();
const rooms=new Map();

const spawnPoints=[
  {x:-45,z:-30},
  {x:45,z:30},
  {x:-45,z:30},
  {x:45,z:-30}
];

const modes={
  "1v1":2,
  "2v2":4
};

/* =========================
   HELPERS
========================= */

function makeWeapons(){

  const weapons={};

  for(
    const name of weaponList
  ){

    const w=WEAPONS[name];

    weapons[name]={
      magazine:w.magazineSize,
      reserve:w.reserveStart
    };

  }

  return weapons;
}

function currentWeapon(player){

  return WEAPONS[
    player.weapon
  ];
}

function sendWeaponState(socket){

  const player=
    players.get(socket.id);

  if(!player){
    return;
  }

  const w=
    player.weapons[
      player.weapon
    ];

  socket.emit(
    "weaponState",
    {
      weapon:player.weapon,
      magazine:w.magazine,
      reserve:w.reserve
    }
  );

}

/* =========================
   ROOMS
========================= */

function createRoom(mode){

  const room={

    id:
      `${mode}-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2,7)}`,

    mode,

    maxPlayers:
      modes[mode],

    players:new Set(),

    ready:new Set(),

    started:false

  };

  rooms.set(
    room.id,
    room
  );

  return room;
}

function findRoom(mode){

  for(
    const room of rooms.values()
  ){

    if(
      room.mode===mode &&
      !room.started &&
      room.players.size<
      room.maxPlayers
    ){

      return room;
    }

  }

  return createRoom(mode);
}

function sendRoomUpdate(room){

  io.to(room.id).emit(
    "roomUpdate",
    {
      mode:room.mode,
      players:room.players.size,
      maxPlayers:room.maxPlayers,
      ready:room.ready.size
    }
  );

}

/* =========================
   REMOVE ROOM
========================= */

function removeFromRoom(socket){

  if(!socket.roomId){
    return;
  }

  const room=
    rooms.get(
      socket.roomId
    );

  if(!room){
    socket.roomId=null;
    return;
  }

  room.players.delete(
    socket.id
  );

  room.ready.delete(
    socket.id
  );

  socket.leave(
    room.id
  );

  socket.roomId=null;

  if(
    room.players.size===0
  ){

    rooms.delete(
      room.id
    );

    return;

  }

  sendRoomUpdate(room);

}

/* =========================
   TEAMS
========================= */

function assignTeams(room){

  const ids=[
    ...room.players
  ];

  ids.forEach(
    (id,index)=>{

      const player=
        players.get(id);

      if(!player){
        return;
      }

      player.team=
        room.mode==="1v1"
        ?(index===0?"A":"B")
        :(index<2?"A":"B");

    }
  );

}

/* =========================
   START
========================= */

function startMatch(room){

  if(room.started){
    return;
  }

  if(
    room.players.size !==
    room.maxPlayers
  ){
    return;
  }

  if(
    room.ready.size !==
    room.maxPlayers
  ){
    return;
  }

  room.started=true;

  assignTeams(room);

  let index=0;

  for(
    const id of room.players
  ){

    const player=
      players.get(id);

    if(!player){
      continue;
    }

    const spawn=
      spawnPoints[
        index %
        spawnPoints.length
      ];

    player.x=spawn.x;
    player.z=spawn.z;
    player.hp=100;
    player.alive=true;
    player.reloading=false;
    player.lastShot=0;

    player.weapon="Pistol";
    player.weapons=
      makeWeapons();

    index++;

  }

  for(
    const id of room.players
  ){

    const player=
      players.get(id);

    io.to(id).emit(
      "matchStart",
      {
        mode:room.mode,
        myTeam:player.team,

        players:[
          ...room.players
        ]
        .map(
          pid=>
            players.get(pid)
        )
        .filter(Boolean)

      }
    );

    sendWeaponState(
      io.sockets.sockets.get(id)
    );

  }

}

/* =========================
   WINNER
========================= */

function checkWinner(room){

  const aliveTeams=
    new Set();

  for(
    const id of room.players
  ){

    const player=
      players.get(id);

    if(
      player &&
      player.alive
    ){

      aliveTeams.add(
        player.team
      );

    }

  }

  if(
    aliveTeams.size<=1
  ){

    const winnerTeam=
      aliveTeams.size===1
      ?[...aliveTeams][0]
      :null;

    io.to(room.id).emit(
      "matchEnd",
      {
        winnerTeam
      }
    );

    room.started=false;
    room.ready.clear();

  }

}

/* =========================
   SHOOT
========================= */

function shoot(socket){

  const player=
    players.get(
      socket.id
    );

  const room=
    rooms.get(
      socket.roomId
    );

  if(
    !player ||
    !room ||
    !room.started ||
    !player.alive ||
    player.reloading
  ){

    return;
  }

  const now=Date.now();

  const weapon=
    currentWeapon(player);

  if(
    now-player.lastShot<
    weapon.fireDelay
  ){

    return;
  }

  const ammo=
    player.weapons[
      player.weapon
    ];

  if(
    ammo.magazine<=0
  ){

    sendWeaponState(socket);

    return;
  }

  player.lastShot=now;

  ammo.magazine--;

  let target=null;
  let closest=Infinity;

  for(
    const id of room.players
  ){

    if(
      id===socket.id
    ){
      continue;
    }

    const enemy=
      players.get(id);

    if(
      !enemy ||
      !enemy.alive
    ){
      continue;
    }

    /* Friendly fire OFF */

    if(
      enemy.team===
      player.team
    ){
      continue;
    }

    const dx=
      player.x-enemy.x;

    const dz=
      player.z-enemy.z;

    const distance=
      Math.hypot(dx,dz);

    if(
      distance<=weapon.range &&
      distance<closest
    ){

      closest=distance;
      target=enemy;

    }

  }

  if(target){

    let damage=
      weapon.damage;

    if(
      player.weapon===
      "Shotgun"
    ){

      damage=
        weapon.damage*
        weapon.pellets;

    }

    target.hp=
      Math.max(
        0,
        target.hp-damage
      );

    if(
      target.hp===0
    ){

      target.alive=false;

    }

    io.to(room.id).emit(
      "playerHit",
      {
        id:target.id,
        hp:target.hp,
        alive:target.alive
      }
    );

    if(
      !target.alive
    ){

      checkWinner(room);

    }

  }

  sendWeaponState(socket);

}

/* =========================
   RELOAD
========================= */

function reload(socket){

  const player=
    players.get(
      socket.id
    );

  if(
    !player ||
    !player.alive ||
    player.reloading
  ){
    return;
  }

  const weapon=
    currentWeapon(player);

  const ammo=
    player.weapons[
      player.weapon
    ];

  if(
    ammo.magazine>=
    weapon.magazineSize
  ){
    return;
  }

  if(
    ammo.reserve<=0
  ){
    return;
  }

  player.reloading=true;

  setTimeout(
    ()=>{

      if(
        !players.has(
          socket.id
        )
      ){
        return;
      }

      const p=
        players.get(
          socket.id
        );

      if(!p){
        return;
      }

      const w=
        currentWeapon(p);

      const a=
        p.weapons[
          p.weapon
        ];

      const needed=
        w.magazineSize-
        a.magazine;

      const amount=
        Math.min(
          needed,
          a.reserve
        );

      a.magazine+=amount;
      a.reserve-=amount;

      p.reloading=false;

      sendWeaponState(socket);

    },
    weapon.reloadTime
  );

}

/* =========================
   SWITCH WEAPON
========================= */

function switchWeapon(socket){

  const player=
    players.get(
      socket.id
    );

  if(
    !player ||
    !player.alive ||
    player.reloading
  ){
    return;
  }

  const current=
    weaponList.indexOf(
      player.weapon
    );

  const next=
    (current+1)%
    weaponList.length;

  player.weapon=
    weaponList[next];

  sendWeaponState(socket);

}

/* =========================
   CONNECTION
========================= */

io.on(
  "connection",
  socket=>{

    players.set(
      socket.id,
      {
        id:socket.id,

        x:0,
        y:0,
        z:0,

        hp:100,
        alive:true,

        team:null,

        weapon:"Pistol",
        weapons:makeWeapons(),

        lastShot:0,
        reloading:false
      }
    );

    socket.emit(
      "init",
      {
        id:socket.id
      }
    );

    /* MODE */

    socket.on(
      "selectMode",
      mode=>{

        if(!modes[mode]){
          return;
        }

        removeFromRoom(socket);

        const room=
          findRoom(mode);

        room.players.add(
          socket.id
        );

        socket.roomId=
          room.id;

        socket.join(
          room.id
        );

        sendRoomUpdate(room);

      }
    );

    /* READY */

    socket.on(
      "ready",
      isReady=>{

        const room=
          rooms.get(
            socket.roomId
          );

        if(
          !room ||
          room.started
        ){
          return;
        }

        if(isReady){

          room.ready.add(
            socket.id
          );

        }else{

          room.ready.delete(
            socket.id
          );

        }

        sendRoomUpdate(room);

        startMatch(room);

      }
    );

    /* MOVE */

    socket.on(
      "move",
      data=>{

        const room=
          rooms.get(
            socket.roomId
          );

        const player=
          players.get(
            socket.id
          );

        if(
          !room ||
          !room.started ||
          !player ||
          !player.alive
        ){
          return;
        }

        const x=
          Number(data.x);

        const z=
          Number(data.z);

        if(
          !Number.isFinite(x) ||
          !Number.isFinite(z)
        ){
          return;
        }

        player.x=
          Math.max(
            -62,
            Math.min(
              62,
              x
            )
          );

        player.z=
          Math.max(
            -62,
            Math.min(
              62,
              z
            )
          );

        socket.to(room.id).emit(
          "playerMoved",
          player
        );

      }
    );

    /* WEAPONS */

    socket.on(
      "shoot",
      ()=>{
        shoot(socket);
      }
    );

    socket.on(
      "reload",
      ()=>{
        reload(socket);
      }
    );

    socket.on(
      "switchWeapon",
      ()=>{
        switchWeapon(socket);
      }
    );

    /* DISCONNECT */

    socket.on(
      "disconnect",
      ()=>{

        const room=
          rooms.get(
            socket.roomId
          );

        removeFromRoom(socket);

        players.delete(
          socket.id
        );

        if(
          room &&
          room.started
        ){

          checkWinner(room);

        }

      }
    );

  }
);

/* =========================
   SERVER
========================= */

const PORT=
  process.env.PORT || 3000;

server.listen(
  PORT,
  ()=>{
    console.log(
      `Chittorgarh server running on port ${PORT}`
    );
  }
);
