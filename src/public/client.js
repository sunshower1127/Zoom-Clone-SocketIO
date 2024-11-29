const socket = io();

const myFace = document.getElementById("myFace");
const muteBtn = document.getElementById("mute");
const cameraBtn = document.getElementById("camera");
const camerasSelect = document.getElementById("cameras");
const call = document.getElementById("call");

call.hidden = true;

let myStream;
let muted = false;
let cameraOff = false;
let roomName;
let myPeerConnection;
let myDataChannel;
let isRoomCreator = false;

const CHUNK_SIZE = 16384; // 16KB 단위로 분할

async function getCameras() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const cameras = devices.filter((device) => device.kind === "videoinput");
    const currentCamera = myStream.getVideoTracks()[0];
    cameras.forEach((camera) => {
      const option = document.createElement("option");
      option.value = camera.deviceId;
      option.innerText = camera.label;
      if (currentCamera.label === camera.label) {
        option.selected = true;
      }
      camerasSelect.appendChild(option);
    });
  } catch (e) {
    console.log(e);
  }
}

async function getMedia(deviceId) {
  const initialConstrains = {
    audio: true,
    video: { facingMode: "user" },
  };
  const cameraConstraints = {
    audio: true,
    video: { deviceId: { exact: deviceId } },
  };
  try {
    myStream = await navigator.mediaDevices.getUserMedia(
      deviceId ? cameraConstraints : initialConstrains
    );
    myFace.srcObject = myStream;
    if (!deviceId) {
      await getCameras();
    }
  } catch (e) {
    console.log(e);
  }
}

function handleMuteClick() {
  myStream
    .getAudioTracks()
    .forEach((track) => (track.enabled = !track.enabled));
  if (!muted) {
    muteBtn.innerText = "Unmute";
    muted = true;
  } else {
    muteBtn.innerText = "Mute";
    muted = false;
  }
}
function handleCameraClick() {
  myStream
    .getVideoTracks()
    .forEach((track) => (track.enabled = !track.enabled));
  if (cameraOff) {
    cameraBtn.innerText = "Turn Camera Off";
    cameraOff = false;
  } else {
    cameraBtn.innerText = "Turn Camera On";
    cameraOff = true;
  }
}

async function handleCameraChange() {
  await getMedia(camerasSelect.value);
  if (myPeerConnection) {
    const videoTrack = myStream.getVideoTracks()[0];
    const videoSender = myPeerConnection
      .getSenders()
      .find((sender) => sender.track.kind === "video");
    videoSender.replaceTrack(videoTrack);
  }
}

muteBtn.addEventListener("click", handleMuteClick);
cameraBtn.addEventListener("click", handleCameraClick);
camerasSelect.addEventListener("input", handleCameraChange);

// Welcome Form (join a room)

const welcome = document.getElementById("welcome");
const welcomeForm = welcome.querySelector("form");

async function initCall() {
  welcome.hidden = true;
  call.hidden = false;
  await getMedia();
  makeConnection();
}

async function handleWelcomeSubmit(event) {
  event.preventDefault();
  const input = welcomeForm.querySelector("input");
  await initCall();
  socket.emit("join_room", input.value);
  roomName = input.value;
  input.value = "";
}

welcomeForm.addEventListener("submit", handleWelcomeSubmit);

// Socket Code

socket.on("welcome", async () => {
  myDataChannel = myPeerConnection.createDataChannel("chat");
  myDataChannel.addEventListener("message", handleReceiveMessage);
  console.log("made data channel");
  const offer = await myPeerConnection.createOffer();
  myPeerConnection.setLocalDescription(offer);
  socket.emit("offer", offer, roomName);
});

socket.on("offer", async (offer) => {
  console.log("received the offer");
  myPeerConnection.setRemoteDescription(offer);
  const answer = await myPeerConnection.createAnswer();
  myPeerConnection.setLocalDescription(answer);
  socket.emit("answer", answer, roomName);
  console.log("sent the answer");
});

socket.on("answer", (answer) => {
  console.log("received the answer");
  myPeerConnection.setRemoteDescription(answer);
});

socket.on("ice", (ice) => {
  console.log("received candidate");
  myPeerConnection.addIceCandidate(ice);
});

// RTC Code

function makeConnection() {
  myPeerConnection = new RTCPeerConnection({
    iceServers: [
      {
        urls: [
          "stun:stun.l.google.com:19302",
          "stun:stun1.l.google.com:19302",
          "stun:stun2.l.google.com:19302",
          "stun:stun3.l.google.com:19302",
        ],
      },
    ],
  });

  if (isRoomCreator) {
    myDataChannel = myPeerConnection.createDataChannel("chat");
    myDataChannel.addEventListener("message", handleReceiveMessage);
  } else {
    myPeerConnection.addEventListener("datachannel", (event) => {
      myDataChannel = event.channel;
      myDataChannel.addEventListener("message", handleReceiveMessage);
    });
  }

  myPeerConnection.addEventListener("icecandidate", handleIce);
  myPeerConnection.addEventListener("track", handleTrack);
  myStream
    .getTracks()
    .forEach((track) => myPeerConnection.addTrack(track, myStream));
}

function handleIce(data) {
  console.log("sent candidate");
  socket.emit("ice", data.candidate, roomName);
}

function handleTrack(event) {
  const peerFace = document.getElementById("peerFace");
  if (event.streams && event.streams[0]) {
    peerFace.srcObject = event.streams[0];
  }
}

// 메시지 전송 처리
function handleChatSubmit(event) {
  event.preventDefault();
  const input = document.querySelector("#chat-input");
  const message = input.value;

  if (message.trim() !== "") {
    myDataChannel.send(
      JSON.stringify({
        type: "chat",
        message: message,
      })
    );
    appendMessage("나: " + message);
    input.value = "";
  }
}

// 파일 전송 처리 수정
async function handleFileShare() {
  const fileInput = document.querySelector("#file-input");
  const file = fileInput.files[0];

  if (file) {
    // 먼저 파일 정보를 전송
    myDataChannel.send(
      JSON.stringify({
        type: "file-info",
        filename: file.name,
        fileSize: file.size,
        fileType: file.type,
      })
    );

    // 파일을 청크 단위로 나눠서 전송
    const reader = new FileReader();
    let offset = 0;

    reader.onload = (e) => {
      const data = e.target.result;
      while (offset < data.byteLength) {
        const chunk = data.slice(offset, offset + CHUNK_SIZE);
        myDataChannel.send(chunk);
        offset += chunk.byteLength;
      }
      // 전송 완료 신호
      myDataChannel.send(
        JSON.stringify({
          type: "file-complete",
        })
      );
    };

    reader.readAsArrayBuffer(file);
  }
}

// 파일 수신 처리 수정
let receiveBuffer = [];
let receivedSize = 0;
let fileInfo = null;

function handleReceiveMessage(event) {
  try {
    // 텍스트 메시지인 경우
    const data = JSON.parse(event.data);

    if (data.type === "chat") {
      appendMessage("상대방: " + data.message);
    } else if (data.type === "file-info") {
      // 새로운 파일 수신 시작
      fileInfo = data;
      receiveBuffer = [];
      receivedSize = 0;
      appendMessage(`파일 수신 중: ${data.filename}`);
    } else if (data.type === "file-complete") {
      // 파일 수신 완료
      const received = new Blob(receiveBuffer);
      const downloadLink = document.createElement("a");
      downloadLink.href = URL.createObjectURL(received);
      downloadLink.download = fileInfo.filename;
      downloadLink.innerHTML = `${fileInfo.filename} 다운로드`;
      downloadLink.style.display = "block";
      document.querySelector("#messages").appendChild(downloadLink);

      // 버퍼 초기화
      receiveBuffer = [];
      receivedSize = 0;
      fileInfo = null;
    }
  } catch (e) {
    // 바이너리 데이터(파일 청크)인 경우
    if (fileInfo) {
      receiveBuffer.push(event.data);
      receivedSize += event.data.byteLength;

      // 진행률 표시 (선택사항)
      const progress = (receivedSize / fileInfo.fileSize) * 100;
      console.log(`파일 수신 진행률: ${progress.toFixed(2)}%`);
    }
  }
}

// 메시지 화면에 표시
function appendMessage(message) {
  const messagesDiv = document.querySelector("#messages");
  const messageElement = document.createElement("p");
  messageElement.textContent = message;
  messagesDiv.appendChild(messageElement);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

// 이벤트 리스너 추가
document
  .querySelector("#chat-form")
  .addEventListener("submit", handleChatSubmit);
document.querySelector("#send-file").addEventListener("click", handleFileShare);

socket.on("room_created", () => {
  isRoomCreator = true;
});
