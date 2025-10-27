import { useEffect, useRef } from "react";

const VideoStream = ({ stream, isLocal, userId, onStart, onStop }) => {
    const videoRef = useRef(null);
    const streamRef = useRef(null); // Store current stream to track changes

    useEffect(() => {
        const video = videoRef.current;
        if (!video || !stream) return;

        console.log(`🎥 Attaching ${isLocal ? 'local' : 'remote'} stream`);

        // Only update if stream is different
        if (streamRef.current !== stream) {
            console.log('New stream:', stream);
            streamRef.current = stream;
            video.srcObject = stream;

            console.log('Stream video tracks:', stream.getVideoTracks());
            console.log('Stream audio tracks:', stream.getAudioTracks());

            // Event listeners for debugging
            video.onloadedmetadata = () => console.log("✅ metadata loaded");
            video.oncanplay = () => console.log("✅ canplay fired");
            video.onplay = () => console.log("✅ playing");

            // Since autoPlay is enabled, manual play() is usually unnecessary
            // Only call play() if needed (e.g., browser blocks autoPlay)
            if (!video.autoplay) {
                video.play()
                    .then(() => console.log(`✅ ${isLocal ? 'local' : 'remote'} is playing`))
                    .catch(err => console.error("❌ play() failed:", err));
            }
            else console.log('autoplay is enabled')
        }

        // Cleanup: Reset srcObject and event listeners when stream changes or unmounts
        return () => {
            if (video) {
                video.srcObject = null;
                video.onloadedmetadata = null;
                video.oncanplay = null;
                video.onplay = null;
            }
            streamRef.current = null;
        };
    }, [stream, isLocal]);

    return (
        <div className="video-box">
            <h3>{isLocal ? 'Local Video' : `Remote Video (${userId})`}</h3>
            <video
                ref={videoRef}
                autoPlay
                playsInline
                muted={isLocal}
                style={{ width: "100%", background: "black" }}
            />
            {isLocal && (
                <div className="video-controls">
                    <button onClick={onStart} disabled={!!stream}>
                        Start Video
                    </button>
                    <button onClick={onStop} disabled={!stream}>
                        Stop Video
                    </button>
                </div>
            )}
        </div>
    );
};

export default VideoStream;