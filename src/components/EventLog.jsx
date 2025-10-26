import { useState } from 'react';

const EventLog = () => {
    const [logs, setLogs] = useState([]);

    const addLog = (message, type = 'info') => {
        const timestamp = new Date().toLocaleTimeString();
        setLogs(prev => [...prev, { timestamp, message, type }]);
    };

    const clearLogs = () => {
        setLogs([]);
    };

    return (
        <div className="event-log">
            <h3>Event Log</h3>
            <div className="log">
                {logs.map((log, index) => (
                    <div key={index} className={`log-entry ${log.type}`}>
                        [{log.timestamp}] {log.message}
                    </div>
                ))}
            </div>
            <button onClick={clearLogs}>Clear Log</button>
        </div>
    );
};

export default EventLog;