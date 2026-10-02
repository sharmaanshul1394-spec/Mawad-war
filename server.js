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

const players =
  new Map();

const spawnPoints = [

  { x: -45, z: -30 },
  { x: 35, z: -25 },
  { x: -30, z: 35 },
  { x: 40, z: 35 },
  { x: 0, z: -45 },
  { x: -45, z: 5 },
  { x: 45, z: 5 },
  { x: 0, z: 45 }

];

io.on(
  "connection",
  socket => {

    const spawn =
      spawnPoints[
        Math.floor(
          Math.random() *
          spawnPoints.length
        )
      ];

    const player = {

      id: socket.id,

      x: spawn.x,

      y: 0,

      z: spawn.z,

      hp: 100,

      alive: true

    };

    players.set(
      socket.id,
      player
    );

    socket.emit(
      "init",
      {
        id: socket.id,
        players: [
          ...players.values()
        ]
      }
    );

    socket.broadcast.emit(
      "playerJoined",
      player
    );

    socket.on(
      "move",
      data => {

        const player =
          players.get(
            socket.id
          );

        if(
          !player ||
          !player.alive
        ){

          return;

        }

        const x =
          Number(data.x);

        const z =
          Number(data.z);

        if(
          !Number.isFinite(x) ||
          !Number.isFinite(z)
        ){

          return;

        }

        player.x =
          Math.max(
            -62,
            Math.min(
              62,
              x
            )
          );

        player.z =
          Math.max(
            -62,
            Math.min(
              62,
              z
            )
          );

        io.emit(
          "playerMoved",
          player
        );

      }
    );

    socket.on(
      "shoot",
      targetId => {

        const shooter =
          players.get(
            socket.id
          );

        const target =
          players.get(
            targetId
          );

        if(
          !shooter ||
          !target ||
          !shooter.alive ||
          !target.alive
        ){

          return;

        }

        const dx =
          shooter.x -
          target.x;

        const dz =
          shooter.z -
          target.z;

        const distance =
          Math.sqrt(
            dx*dx+
            dz*dz
          );

        if(
          distance>30
        ){

          return;

        }

        target.hp =
          Math.max(
            0,
            target.hp-25
          );

        if(
          target.hp===0
        ){

          target.alive=false;

        }

        io.emit(
          "playerHit",
          {
            id:target.id,
            hp:target.hp,
            alive:target.alive
          }
        );

      }
    );

    socket.on(
      "disconnect",
      () => {

        players.delete(
          socket.id
        );

        io.emit(
          "playerLeft",
          socket.id
        );

      }
    );

  }
);

const PORT =
  process.env.PORT || 3000;

server.listen(
  PORT,
  () => {

    console.log(
      `Server running on port ${PORT}`
    );

  }
);
