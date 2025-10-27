import React, { useEffect, useRef } from 'react';

const VideoPlayer = React.memo(({ stream, isLocal = false, userId = '', onStart, onStop }) => {
    const videoRef = useRef(null);
    const streamRef = useRef(null); // Store current stream to track changes

    useEffect(() => {
        const video = videoRef.current;
        if (!video || !stream) {
            if (!stream) console.log('No stream provided');
            return;
        }

        console.log(`🎥 Attaching ${isLocal ? 'local' : 'remote'} stream`);

        // Only update if stream is different
        if (streamRef.current !== stream) {
            console.log('🎯 New stream detected:', stream.id);
            streamRef.current = stream;

            // Validate stream
            const videoTracks = stream.getVideoTracks();
            const audioTracks = stream.getAudioTracks();

            if (!videoTracks.length && !audioTracks.length) {
                console.error('Invalid stream: No tracks');
                return;
            }

            console.log('Stream video tracks:', videoTracks);
            console.log('Stream audio tracks:', audioTracks);
            console.log('Video track states:', videoTracks.map(t => ({ id: t.id, enabled: t.enabled, readyState: t.readyState })));
            console.log('Audio track states:', audioTracks.map(t => ({ id: t.id, enabled: t.enabled, readyState: t.readyState })));

            // Clear existing srcObject
            if (video.srcObject) {
                video.srcObject = null;
            }

            // Set up event handlers
            const handleMetadata = async () => {
                console.log('✅ metadata loaded - video dimensions:', video.videoWidth, 'x', video.videoHeight);
                console.log('✅ video readyState:', video.readyState);

                // Force play for remote streams
                if (!isLocal) {
                    video.muted = true; // Mute remote streams to allow autoplay
                }

                try {
                    await video.play();
                    console.log(`✅ ${isLocal ? 'local' : 'remote'} video is playing`);
                } catch (err) {
                    console.error('❌ play() failed:', err);
                    if (!isLocal) {
                        video.muted = true;
                        try {
                            await video.play();
                            console.log(`✅ ${isLocal ? 'local' : 'remote'} video playing (muted)`);
                        } catch (err2) {
                            console.error('❌ muted play() also failed:', err2);
                        }
                    }
                }
            };

            const handleLoadStart = () => console.log('🔄 loadstart fired');
            const handleLoadedData = () => {
                console.log('📊 loadeddata fired - readyState:', video.readyState);
                if (video.readyState >= 2) {
                    video.play().catch(err => console.error('Early play attempt failed:', err));
                }
            };
            const handleCanPlay = () => {
                console.log('✅ canplay fired - readyState:', video.readyState);
                video.play().catch(err => console.error('CanPlay play attempt failed:', err));
            };
            const handlePlay = () => console.log('✅ playing event fired');
            const handlePlaying = () => console.log('✅ playing state reached');
            const handleError = (e) => {
                console.error('❌ video error:', e);
                console.error('❌ video error details:', video.error);
            };

            video.onloadstart = handleLoadStart;
            video.onloadeddata = handleLoadedData;
            video.onloadedmetadata = handleMetadata;
            video.oncanplay = handleCanPlay;
            video.onplay = handlePlay;
            video.onplaying = handlePlaying;
            video.onerror = handleError;

            // Set srcObject after event handlers
            console.log('🔄 Setting srcObject...');
            video.srcObject = stream;

            // Fallback attempts
            const metadataTimeout = setTimeout(() => {
                if (video.readyState === 0) {
                    console.log('⚠️ Metadata timeout (3s) - trying to play anyway');
                    video.play().catch(err => console.error('❌ Fallback play failed:', err));
                }
            }, 3000);

            const playTimeout = setTimeout(() => {
                if (video.paused) {
                    console.log('⚠️ Video still paused after 5s - forcing play');
                    if (!isLocal) video.muted = true;
                    video.play().catch(err => console.error('❌ Final fallback play failed:', err));
                }
            }, 5000);

            return () => {
                video.onloadstart = null;
                video.onloadeddata = null;
                video.onloadedmetadata = null;
                video.oncanplay = null;
                video.onplay = null;
                video.onplaying = null;
                video.onerror = null;
                video.srcObject = null;
                clearTimeout(metadataTimeout);
                clearTimeout(playTimeout);
            };
        } else {
            console.log('🎯 Same stream, skipping assignment');
        }
    }, [stream, isLocal]);

    return (
        <div className="video-box" style={{ margin: '10px' }}>
            <h3>{isLocal ? 'Local Video' : `Remote Video (${userId || 'Unknown'})`}</h3>
            <video
                ref={videoRef}
                autoPlay
                playsInline
                muted={isLocal} // Mute local video to avoid echo
                controls={!isLocal} // Add controls for remote video
                style={{ width: '100%', maxWidth: '600px', background: 'black', minHeight: '200px' }}
            />
            {/* Debug info */}
            {stream && (
                <div style={{ fontSize: '12px', color: '#666', marginTop: '5px' }}>
                    Stream ID: {stream.id}<br />
                    Video tracks: {stream.getVideoTracks().length}<br />
                    Audio tracks: {stream.getAudioTracks().length}<br />
                    Active: {stream.active ? 'Yes' : 'No'}
                </div>
            )}
            {isLocal && (
                <div className="video-controls" style={{ marginTop: '10px' }}>
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
});

export default VideoPlayer;