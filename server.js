import express from "express";
import http from "http";
import { Server } from "socket.io";

const app = express();

const server =
  http.createServer(app);

const io =
  new Server(server);

app.use(
  express.static("public")
);

/* =========================
   DATA
========================= */

const players = new Map();
const rooms = new Map();

const spawnPoints = [
  { x:-45, z:-30 },
  { x:45, z:30 },
  { x:-45, z:30 },
  { x:45, z:-30 }
];

const modes = {
  "1v1": 2,
  "2v2": 4
};

/* =========================
   ROOM
========================= */

function createRoom(mode){

  const room = {

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

/* =========================
   ROOM UPDATE
========================= */

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
   REMOVE FROM ROOM
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
   TEAM ASSIGNMENT
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

      if(room.mode==="1v1"){

        player.team=
          index===0
          ?"A"
          :"B";

      }else{

        player.team=
          index<2
          ?"A"
          :"B";

      }

    }
  );

}

/* =========================
   START MATCH
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

  }

}

/* =========================
   CHECK TEAM WINNER
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
        team:null
      }
    );

    socket.emit(
      "init",
      {
        id:socket.id
      }
    );

    /* =====================
       SELECT MODE
    ===================== */

    socket.on(
      "selectMode",
      mode=>{

        if(
          !modes[mode]
        ){

          return;
        }

        removeFromRoom(
          socket
        );

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

    /* =====================
       READY
    ===================== */

    socket.on(
      "ready",
      isReady=>{

        const room=
          rooms.get(
            socket.roomId
          );

        if(!room){
          return;
        }

        if(
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

    /* =====================
       MOVEMENT
    ===================== */

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

    /* =====================
       SHOOT
    ===================== */

    socket.on(
      "shoot",
      ()=>{

        const room=
          rooms.get(
            socket.roomId
          );

        const shooter=
          players.get(
            socket.id
          );

        if(
          !room ||
          !room.started ||
          !shooter ||
          !shooter.alive
        ){

          return;
        }

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

          const candidate=
            players.get(id);

          if(
            !candidate ||
            !candidate.alive
          ){
            continue;
          }

          /*
            FRIENDLY FIRE OFF
          */

          if(
            candidate.team===
            shooter.team
          ){

            continue;
          }

          const dx=
            shooter.x-
            candidate.x;

          const dz=
            shooter.z-
            candidate.z;

          const distance=
            Math.sqrt(
              dx*dx+
              dz*dz
            );

          if(
            distance<=30 &&
            distance<closest
          ){

            closest=distance;
            target=candidate;

          }

        }

        if(!target){
          return;
        }

        /* DAMAGE */

        target.hp=
          Math.max(
            0,
            target.hp-25
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
    );

    /* =====================
       RESERVED ACTIONS
    ===================== */

    socket.on(
      "reload",
      ()=>{
        /* Future server-side reload */
      }
    );

    socket.on(
      "switchWeapon",
      ()=>{
        /* Future server-side weapon switch */
      }
    );

    /* =====================
       DISCONNECT
    ===================== */

    socket.on(
      "disconnect",
      ()=>{

        const room=
          rooms.get(
            socket.roomId
          );

        removeFromRoom(
          socket
        );

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
