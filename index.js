const WebSocket = require('ws');

const wss = new WebSocket.Server({ port: 3000 });

const rooms = {};

const nicknamePool = [
  'moon',
  'sun',
  'star',
  'sky',
  'red',
  'blue',
  'gold',
  'snow',
  'rain',
  'wind',
  'fire',
  'leaf',
  'tree',
  'rock',
  'wave',
  'sea',
  'bird',
  'bear',
  'wolf',
  'fox',
  'lion',
  'cat',
  'dog',
  'bee',
  'owl',
  'mint',
  'pink',
  'gray',
  'lime',
  'neon',
];

function generateNickname(room) {
  const usedNames = new Set(
    room?.clients
      ?.map((client) => client.nickname)
      .filter(Boolean) ?? [],
  );

  const availableNames = nicknamePool.filter(
    (name) => !usedNames.has(name),
  );

  if (availableNames.length > 0) {
    const index = Math.floor(
      Math.random() * availableNames.length,
    );

    return availableNames[index];
  }

  return `user${Math.floor(Math.random() * 100)}`;
}

function generateRoomId() {
  return Math.random()
    .toString(36)
    .substring(2, 6)
    .toUpperCase();
}

function generateParticipantId() {
  return Math.random()
    .toString(36)
    .substring(2, 8)
    .toUpperCase();
}

function send(ws, data) {
  if (ws.readyState !== WebSocket.OPEN) {
    console.log(
      '연결이 닫혀있어 메시지를 보낼 수 없습니다.',
    );
    return;
  }
  ws.send(JSON.stringify(data));
}


function getParticipants(roomId) {
  const room = rooms[roomId];

  return room.clients.map((client, index) => ({
    participantId: client.participantId,
    deviceIndex: index,
    deviceOrder: index + 1,
    screenWidth: client.screenWidth || 0,
    screenHeight: client.screenHeight || 0,
    label: `${index + 1}번 기기`,
    nickname: client.nickname || '',
    isHost: client === room.host,
  }));
}

function broadcastRoomState(roomId) {
  const room = rooms[roomId];

  if (!room) return;

  const participants = getParticipants(roomId);

  room.clients.forEach((client, index) => {
    client.deviceIndex = index;

    send(client, {
      type: 'room_updated',

      roomId,

      participantCount:
          room.clients.length,

      deviceIndex: index,

      totalDevices:
          room.clients.length,

      participantId:
          client.participantId,

      isHost:
          client === room.host,

      participants,
    });
  });
}

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
  });

  console.log('클라이언트 연결됨');

  ws.participantId =
      generateParticipantId();

  ws.on('message', (message) => {

    const data = JSON.parse(
      message.toString(),
    );

    // 방 생성
    if (data.type === 'create_room') {

      const roomId =
          generateRoomId();

      ws.screenWidth = data.screenWidth || 0;
      ws.screenHeight = data.screenHeight || 0;
      
      rooms[roomId] = {
        clients: [ws],
        host: ws,
        playing: false,
        text: 'Success is the sum of small efforts, repeated day in and day out.',
        color: 'white',
        speed: 120,
      };

      ws.roomId = roomId;
      ws.deviceIndex = 0;
      ws.nickname = 'host';
      broadcastRoomState(roomId);
      console.log(
        `방 생성됨: ${roomId}`,
      );
    }

    // 방 참여
    if (data.type === 'join_room') {

      const roomId = String(
        data.roomId || '',
      )
        .trim()
        .toUpperCase();

      if (!rooms[roomId]) {

        send(ws, {
          type: 'error',
          message:
              '존재하지 않는 방입니다.',
        });
        return;
      }
      if (
        rooms[roomId].clients.includes(ws)
      ) {
        broadcastRoomState(roomId);
        return;
      }

      ws.screenWidth = data.screenWidth || 0;
      ws.screenHeight = data.screenHeight || 0;

      rooms[roomId].clients.push(ws);
      ws.roomId = roomId;
      ws.nickname = generateNickname(rooms[roomId]);
      broadcastRoomState(roomId);
      console.log(
        `방 참여: ${roomId}, 인원: ${rooms[roomId].clients.length}`,
      );
    }

    // 순서 변경
    if (
      data.type ===
      'reorder_participants'
    ) {

      const roomId = data.roomId;
      const newOrder =
          data.participantIds;

      if (!Array.isArray(newOrder)) {

        send(ws, {
          type: 'error',
          message:
              '참여자 순서 정보가 올바르지 않습니다.',
        });

        return;
      }


      const room = rooms[roomId];

      if (!room) return;
      if (ws !== room.host) {
        send(ws, {
          type: 'error',
          message:
              '방장만 순서를 변경할 수 있습니다.',
        });

        return;
      }

      const oldClients =
          room.clients;

      const reorderedClients = [];

      newOrder.forEach(
        (participantId) => {

          const found =
              oldClients.find(
            (client) =>
                client.participantId ===
                participantId,
          );

          if (found) {
            reorderedClients.push(found);
          }
        },
      );

      oldClients.forEach((client) => {

        if (
          !reorderedClients.includes(
            client,
          )
        ) {
          reorderedClients.push(client);
        }
      });

      room.clients =
          reorderedClients;

      broadcastRoomState(roomId);

      console.log(
        `순서 변경됨: ${roomId}`,
      );
    }

    // 전광판 시작
    if (
      data.type ===
      'start_display'
    ) {

      const roomId = data.roomId;

      const room = rooms[roomId];

      if (!room) return;

      if (ws !== room.host) {
        send(ws, {
          type: 'error',
          message: '방장만 전광판을 시작할 수 있습니다.',
        });

        return;
      }

      room.playing = true;

      room.text =
          String(data.text || '')
            .replace(/[\r\n]+/g, ' ')
            .trim() ||
          'Success is the sum of small efforts, repeated day in and day out.';

      room.color =
          data.color || 'white';

      room.speed =
          data.speed || 120;

      room.repeat =
          data.repeat !== false;

      room.fontFamily =
          data.fontFamily || 'Pretendard';

      room.blink =
          data.blink === true;

      room.gradient =
          data.gradient === true;

      const startTime =
          Date.now() + 4000;

      room.clients.forEach(
        (client, index) => {

          send(client, {
            type:
                'display_started',

            roomId,

            text: room.text,
            color: room.color,
            speed: room.speed,
            repeat: room.repeat,
            fontFamily: room.fontFamily,
            blink: room.blink,
            gradient: room.gradient,

            startTime,
            serverNow: Date.now(),

            fontSize: data.fontSize,
            textWidth: data.textWidth,
            textHeight: data.textHeight,
            imageHeight: data.imageHeight,
            gapWidth: data.gapWidth,
            totalTravelWidth: data.totalTravelWidth,

            deviceIndex: index,
            deviceOrder: index + 1,
            totalDevices: room.clients.length,
            participants: getParticipants(roomId),
          });
        },
      );

      console.log(
        `전광판 시작: ${roomId}, text=${room.text}`,
      );
    }

    // 누구든 전광판을 종료하면 연결된 모든 기기의 전광판을 종료한다.
    if (data.type === 'stop_display') {
      const roomId = String(data.roomId || '')
        .trim()
        .toUpperCase();
      const room = rooms[roomId];

      if (!room || !room.clients.includes(ws)) {
        return;
      }

      room.playing = false;

      room.clients.forEach((client) => {
        send(client, {
          type: 'display_stopped',
          roomId,
          participantId: ws.participantId,
          serverNow: Date.now(),
        });
      });

      console.log(
        `전광판 전체 종료: ${roomId}, 요청자=${ws.participantId}`,
      );

      return;
    }

    // 참여자 방 나가기 또는 방장의 방 전체 종료
    if (
      data.type === 'leave_room' ||
      data.type === 'close_room' ||
      data.type === 'leave_display'
    ) {
      const roomId = String(data.roomId || '')
        .trim()
        .toUpperCase();
      const room = rooms[roomId];

      if (!room || !room.clients.includes(ws)) {
        return;
      }

      const isHost = ws === room.host;
      const requestedRoomClose =
        data.type === 'close_room' ||
        (
          data.type === 'leave_display' &&
          data.isHost === true
        );

      if (requestedRoomClose && !isHost) {
        send(ws, {
          type: 'error',
          message: '방장만 방을 종료할 수 있습니다.',
        });
        return;
      }

      // 방장이 나가면 방 전체 종료
      if (isHost) {
        room.clients.forEach((client) => {
          send(client, {
            type: 'room_closed',
          });

          client.roomId = null;
          client.deviceIndex = null;
        });

        delete rooms[roomId];

        ws.roomId = null;
        ws.deviceIndex = null;

        console.log(
          `방장 종료 및 방 삭제: ${roomId}`,
        );

        return;
      }

      // 일반 참여자만 방에서 제거
      const wasPlaying = room.playing;

      room.clients =
          room.clients.filter(
            (client) => client !== ws,
          );

      ws.roomId = null;
      ws.deviceIndex = null;

      room.playing = false;

      if (wasPlaying) {
        room.clients.forEach((client) => {
          send(client, {
            type: 'display_stopped',
            roomId,
            participantId: ws.participantId,
            serverNow: Date.now(),
          });
        });
      }

      // 혹시 빈 방이 되었다면 삭제
      if (room.clients.length === 0) {
        delete rooms[roomId];

        console.log(
          `빈 방 삭제됨: ${roomId}`,
        );

        return;
      }

      // 남아 있는 기기의 번호와 참여자 목록 갱신
      broadcastRoomState(roomId);

      console.log(
        `참여자 나가기: ${roomId}, 남은 인원: ${room.clients.length}`,
      );

      return;
    }
  });

  // 네트워크 종료, 앱 강제 종료 등으로 연결이 끊어진 경우
  ws.on('close', () => {
    const roomId = ws.roomId;

    if (
      !roomId ||
      !rooms[roomId]
    ) {
      return;
    }

    const room = rooms[roomId];
    const wasHost = room.host === ws;
    const wasPlaying = room.playing;

    room.clients =
        room.clients.filter(
          (client) => client !== ws,
        );

    ws.roomId = null;
    ws.deviceIndex = null;

    console.log(
      `연결 종료: ${roomId}`,
    );

    // 방장 연결 종료
    if (wasHost) {
      room.clients.forEach((client) => {
        send(client, {
          type: 'room_closed',
        });

        client.roomId = null;
        client.deviceIndex = null;
      });

      delete rooms[roomId];

      console.log(
        `방장 연결 종료로 방 삭제: ${roomId}`,
      );

      return;
    }

    // 일반 참여자 연결 종료
    room.playing = false;

    if (wasPlaying) {
      room.clients.forEach((client) => {
        send(client, {
          type: 'display_stopped',
          roomId,
          participantId: ws.participantId,
          serverNow: Date.now(),
        });
      });
    }

    if (room.clients.length === 0) {
      delete rooms[roomId];

      console.log(
        `빈 방 삭제됨: ${roomId}`,
      );

      return;
    }

    // 남은 참여자에게 새로운 인원수와 순서 전달
    broadcastRoomState(roomId);

    console.log(
      `참여자 연결 종료: ${roomId}, 남은 인원: ${room.clients.length}`,
    );
  });
});

// 유휴 상태에서 네트워크가 조용히 끊긴 연결도 방 인원에서 제거한다.
const heartbeatInterval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) {
      // 기존 close 처리에서 방 인원 갱신과 room_state 전송이 실행된다.
      ws.terminate();
      return;
    }

    ws.isAlive = false;
    ws.ping();
  });
}, 20000);

wss.on('close', () => {
  clearInterval(heartbeatInterval);
});

console.log(
  'WebSocket 서버 실행중...',
);
