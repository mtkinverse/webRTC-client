import { useEffect, useRef } from "react";

const VideoStream = ({ stream, isLocal, userId, onStart, onStop }) => {
    const videoRef = useRef(null);

    useEffect(() => {
        const video = videoRef.current;
        if (!video || !stream) return;

        console.log(`🎥 Attaching ${isLocal ? 'local' : 'remote'} stream`);

        // Important: stop re-assigning if same stream
        if (video.srcObject !== stream) {
            console.log('new stream ', stream)
            videoRef.current.srcObject = stream;
            video.srcObject = stream;

            console.log('Stream video tracks:', stream?.getVideoTracks());
            console.log('Stream audio tracks:', stream?.getAudioTracks());
            // Attach BEFORE play()
            video.onloadedmetadata = () => console.log("✅ metadata loaded");
            video.oncanplay = () => console.log("✅ canplay fired");
            video.onplay = () => console.log("✅ playing");
            // play instantly (no events needed)
            video.play()
                .then(() => console.log(`✅ ${isLocal ? 'local' : 'remote'} is playing`))
                .catch(err => console.error("❌ play() failed:", err));
        }

        const handleMetadata = async () => {
            try {
                await video.play();
                console.log(`✅ ${isLocal ? 'local' : 'remote'} video is playing`);
            } catch (err) {
                console.error(`❌ play() failed:`, err);
            }
        };

        // video.onloadedmetadata = handleMetadata;

        // return () => {
        //     video.onloadedmetadata = null; // cleanup
        // };
    }, [stream]);

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