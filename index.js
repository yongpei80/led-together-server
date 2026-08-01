const WebSocket = require('ws');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const PROTOCOL_VERSION = 2;

const wss = new WebSocket.Server({
  port: PORT,
});

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
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let roomId;

  do {
    roomId = Array.from(
      { length: 8 },
      () => alphabet[crypto.randomInt(alphabet.length)],
    ).join('');
  } while (rooms[roomId]);

  return roomId;
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

    const message = {
      type: 'room_updated',
      roomId,
      participantCount: room.clients.length,
      deviceIndex: index,
      totalDevices: room.clients.length,
      participantId: client.participantId,
      isHost: client === room.host,
      participant: participants[index],
    };

    // 순서 편집이 필요한 방장에게만 전체 목록을 보낸다.
    // 일반 참여자에게 전체 목록을 반복 전송하는 O(N²) 트래픽을 방지한다.
    if (client === room.host) {
      message.participants = participants;
    }

    send(client, message);
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

    // 클라이언트가 네트워크 왕복시간을 고려해 서버 시각을 보정할 수 있도록 응답한다.
    if (data.type === 'time_sync') {
      send(ws, {
        type: 'time_sync_response',
        requestId: data.requestId,
        serverTime: Date.now(),
      });
      return;
    }

    // 방 생성
    if (data.type === 'create_room') {

      if (data.protocolVersion !== PROTOCOL_VERSION) {
        send(ws, {
          type: 'error',
          message: '앱 버전이 맞지 않습니다. 모든 기기의 앱을 업데이트해 주세요.',
        });
        return;
      }

      const roomId =
          generateRoomId();

      ws.screenWidth = data.screenWidth || 0;
      ws.screenHeight = data.screenHeight || 0;
      
      rooms[roomId] = {
        clients: [ws],
        host: ws,
        playing: false,
        text: '',
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

      if (data.protocolVersion !== PROTOCOL_VERSION) {
        send(ws, {
          type: 'error',
          message: '앱 버전이 맞지 않습니다. 모든 기기의 앱을 업데이트해 주세요.',
        });
        return;
      }

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

      room.text = String(data.text || '')
        .replace(/[\r\n]+/g, ' ')
        .trim();

      if (!room.text) {
        send(ws, {
          type: 'error',
          message: '전광판 문구를 입력해 주세요.',
        });
        return;
      }

      room.playing = true;

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

      const broadcastServerNow = Date.now();

      // Display 렌더링에는 참여자 개인정보가 아닌 배치 순서별 너비만 필요하다.
      // 전체 participant 객체 대신 숫자 배열을 보내 메시지 크기를 줄인다.
      const deviceWidths = room.clients.map(
        (client) => Number(client.screenWidth) || 0,
      );

      room.clients.forEach(
        (client, index) => {

          send(client, {
            type:
                'display_started',

            protocolVersion: PROTOCOL_VERSION,

            roomId,

            text: room.text,
            color: room.color,
            speed: room.speed,
            repeat: room.repeat,
            fontFamily: room.fontFamily,
            blink: room.blink,
            gradient: room.gradient,

            startTime,
            serverNow: broadcastServerNow,

            fontSize: data.fontSize,
            textWidth: data.textWidth,
            textHeight: data.textHeight,
            imageHeight: data.imageHeight,
            gapWidth: data.gapWidth,
            totalTravelWidth: data.totalTravelWidth,

            deviceIndex: index,
            deviceOrder: index + 1,
            totalDevices: room.clients.length,
            deviceWidths,
          });
        },
      );

      console.log(
        `전광판 시작: ${roomId}, textLength=${room.text.length}, devices=${room.clients.length}`,
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
  `WebSocket 서버 실행중... PORT=${PORT}`,
);
