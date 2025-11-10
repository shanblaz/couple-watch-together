import React, { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import "./style.css";

const SERVER = import.meta.env.VITE_SERVER || "http://localhost:4000";
const ROOM_ID = "room-couple-123";

export default function App() {
  const videoRef = useRef(null);
  const remoteAudioRef = useRef(null);
  const pcRef = useRef(null);
  const socketRef = useRef(null);
  const localStreamRef = useRef(null);

  const [isHost, setIsHost] = useState(false);
  const [peerId, setPeerId] = useState(null);
  const [partnerOnline, setPartnerOnline] = useState(false);
  const [status, setStatus] = useState("Waiting for partner...");

  const now = () => Date.now();

  useEffect(() => {
    socketRef.current = io(SERVER, { transports: ["websocket"] });

    socketRef.current.on("connect", () => {
      socketRef.current.emit("join-room", {
        roomId: ROOM_ID,
        userId: socketRef.current.id,
      });
    });

    socketRef.current.on("peer-joined", ({ peerId }) => {
      setPartnerOnline(true);
      setStatus("Partner joined 👋");
      if (!pcRef.current) setIsHost(true);
      setPeerId(peerId);
      createPeerConnection(peerId, true);
    });

    socketRef.current.on("signal", async ({ from, data }) => {
      if (!pcRef.current) await createPeerConnection(from, false);
      if (data.sdp) {
        await pcRef.current.setRemoteDescription(data.sdp);
        if (data.sdp.type === "offer") {
          const answer = await pcRef.current.createAnswer();
          await pcRef.current.setLocalDescription(answer);
          socketRef.current.emit("signal", {
            to: from,
            data: { sdp: pcRef.current.localDescription },
          });
        }
      } else if (data.ice) {
        try {
          await pcRef.current.addIceCandidate(data.ice);
        } catch (e) {}
      }
    });

    socketRef.current.on("playback-command", handlePlaybackCommand);

    socketRef.current.on("peer-left", () => {
      setPartnerOnline(false);
      setStatus("Partner left 💔");
      if (pcRef.current) pcRef.current.close();
      pcRef.current = null;
    });

    return () => {
      socketRef.current.disconnect();
    };
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const s = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true },
        });
        localStreamRef.current = s;
      } catch (e) {
        console.warn("Mic access failed", e);
      }
    })();
  }, []);

  async function createPeerConnection(otherPeerId, isInitiator) {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });
    pcRef.current = pc;

    if (localStreamRef.current) {
      localStreamRef.current
        .getAudioTracks()
        .forEach((t) => pc.addTrack(t, localStreamRef.current));
    }

    pc.onicecandidate = (e) => {
      if (e.candidate)
        socketRef.current.emit("signal", {
          to: otherPeerId,
          data: { ice: e.candidate },
        });
    };

    pc.ontrack = (ev) => {
      const [stream] = ev.streams;
      remoteAudioRef.current.srcObject = stream;
      setupAudioMixing(stream);
    };

    if (isInitiator) {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socketRef.current.emit("signal", {
        to: otherPeerId,
        data: { sdp: pc.localDescription },
      });
    }
  }

  function setupAudioMixing(remoteStream) {
    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const videoEl = videoRef.current;
      const videoSource = audioCtx.createMediaElementSource(videoEl);
      const remoteSource = audioCtx.createMediaStreamSource(remoteStream);

      const videoGain = audioCtx.createGain();
      const remoteGain = audioCtx.createGain();
      const masterGain = audioCtx.createGain();

      videoGain.gain.value = 1.0;
      remoteGain.gain.value = 1.0;
      masterGain.gain.value = 1.0;

      videoSource.connect(videoGain).connect(masterGain);
      remoteSource.connect(remoteGain).connect(masterGain);
      masterGain.connect(audioCtx.destination);

      if (audioCtx.state === "suspended") audioCtx.resume();
    } catch (e) {
      console.warn("Mixing failed", e);
    }
  }

  function sendPlaybackCommand(cmd) {
    const v = videoRef.current;
    socketRef.current.emit("playback-command", {
      roomId: ROOM_ID,
      cmd,
      currentTime: v.currentTime,
      clientTs: now(),
    });
  }

  function handlePlaybackCommand({ cmd, currentTime, clientTs }) {
    const v = videoRef.current;
    const latencyMs = now() - clientTs;
    if (cmd === "play") {
      v.currentTime = currentTime + latencyMs / 1000;
      v.play().catch(console.error);
    } else if (cmd === "pause") {
      v.currentTime = currentTime;
      v.pause();
    } else if (cmd === "seek") {
      v.currentTime = currentTime;
    }
  }

  return (
    <div className="container">
      <h1>🎬 Couple Watch Together</h1>
      <p className="status">{status}</p>

      <div className="player-wrapper">
        <video
          ref={videoRef}
          className="video-player"
          controls
          src="/videos/sample.mp4"
          crossOrigin="anonymous"
          onPlay={() => isHost && sendPlaybackCommand("play")}
          onPause={() => isHost && sendPlaybackCommand("pause")}
          onSeeked={() => isHost && sendPlaybackCommand("seek")}
        />
        <audio ref={remoteAudioRef} autoPlay hidden />
      </div>

      <div className="controls">
        <button onClick={() => videoRef.current.play()}>▶️ Play</button>
        <button onClick={() => videoRef.current.pause()}>⏸ Pause</button>
        <button
          onClick={async () => {
            if (!pcRef.current && peerId) await createPeerConnection(peerId, true);
            alert("Mic connected — talk with your partner!");
          }}
        >
          🎤 Connect Voice
        </button>
        <button onClick={() => sendPlaybackCommand("seek")}>🔄 Sync</button>
      </div>

      <footer>
        <small>
          Host: {isHost ? "You" : "Partner"} •{" "}
          {partnerOnline ? "Connected ✅" : "Not Connected ❌"}
        </small>
      </footer>
    </div>
  );
}