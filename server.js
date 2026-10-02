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

const players=
  new Map();

const rooms=
  new Map();

const spawnPoints=[
  {x:-45,z:-30},
  {x:35,z:-25},
  {x:-30,z:35},
  {x:40,z:35}
];

const modes={
  "1v1":2,
  "2v2":4
};

function getRoom(mode){

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

function removeFromRoom(socket){

  if(!socket.roomId){
    return;
  }

  const room=
    rooms.get(
      socket.roomId
    );

  if(!room){
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

  let index=0;

  for(
    const id of room.players
  ){

    const player=
      players.get(id);

    if(!player)continue;

    player.alive=true;
    player.hp=100;

    const spawn=
      spawnPoints[
        index %
        spawnPoints.length
      ];

    player.x=spawn.x;
    player.z=spawn.z;

    index++;

  }

  io.to(room.id).emit(
    "matchStart",
    {
      mode:room.mode,
      players:[
        ...room.players
      ]
      .map(id=>
        players.get(id)
      )
      .filter(Boolean)
    }
  );

  for(
    const id of room.players
  ){

    io.to(id).emit(
      "playerMoved",
      players.get(id)
    );

  }
}

io.on(
  "connection",
  socket=>{

    const spawn=
      spawnPoints[
        Math.floor(
          Math.random()*
          spawnPoints.length
        )
      ];

    players.set(
      socket.id,
      {
        id:socket.id,
        x:spawn.x,
        y:0,
        z:spawn.z,
        hp:100,
        alive:true
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
          getRoom(mode);

        room.players.add(
          socket.id
        );

        socket.roomId=
          room.id;

        socket.join(
          room.id
        );

        sendRoomUpdate(
          room
        );

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

        if(!room)return;

        if(isReady){

          room.ready.add(
            socket.id
          );

        }else{

          room.ready.delete(
            socket.id
          );

        }

        sendRoomUpdate(
          room
        );

        startMatch(
          room
        );

      }
    );

    /* =====================
       MOVE
    ===================== */

    socket.on(
      "move",
      data=>{

        const player=
          players.get(
            socket.id
          );

        if(
          !player ||
          !player.alive
        ){

          return;
        }

        const room=
          rooms.get(
            socket.roomId
          );

        if(
          !room ||
          !room.started
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

          checkWinner(
            room
          );

        }

      }
    );

    /* =====================
       RELOAD / SWITCH
       Reserved for future
       server-authoritative
       weapon inventory.
    ===================== */

    socket.on(
      "reload",
      ()=>{}
    );

    socket.on(
      "switchWeapon",
      ()=>{}
    );

    /* =====================
       DISCONNECT
    ===================== */

    socket.on(
      "disconnect",
      ()=>{

        removeFromRoom(
          socket
        );

        players.delete(
          socket.id
        );

      }
    );

  }
);

function checkWinner(room){

  const alive=
    [...room.players]
    .filter(
      id=>{
        const p=
          players.get(id);

        return p &&
          p.alive;
      }
    );

  if(
    alive.length===1
  ){

    const winner=
      alive[0];

    io.to(room.id).emit(
      "matchEnd",
      {
        winner
      }
    );

    room.started=false;
    room.ready.clear();

  }

}

const PORT=
  process.env.PORT || 3000;

server.listen(
  PORT,
  ()=>{
    console.log(
      `Server running on port ${PORT}`
    );
  }
);
