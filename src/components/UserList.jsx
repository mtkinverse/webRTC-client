const UserList = ({ users, currentUserId }) => {
    return (
        <div className="user-list-container">
            <h3>Users in Room</h3>
            <div className="user-list">
                {users.length > 0 ? (
                    users.map(user => (
                        <span
                            key={user.id || user.userId}
                            className={`user-badge ${(user.id || user.userId) === currentUserId ? 'self' : ''}`}
                        >
                            {user.name || user.userName || user.id || user.userId}
                            {(user.id || user.userId) === currentUserId && ' (You)'}
                        </span>
                    ))
                ) : (
                    <span>No users</span>
                )}
            </div>
        </div>
    );
};

export default UserList;