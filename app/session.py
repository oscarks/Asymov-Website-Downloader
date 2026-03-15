"""
Shared session state for SSE message queues and background task results.
"""

import os
import time
import threading

message_queues = {}
download_results = {}
extract_results = {}
assistant_results = {}


def cleanup_abandoned_sessions():
    """Clean up sessions that were never downloaded after 30 minutes"""
    while True:
        time.sleep(300)  # Check every 5 minutes
        current_time = time.time()

        sessions_to_remove = []
        for session_id, result in list(download_results.items()):
            if result.get('status') == 'complete' and result.get('created_at'):
                age = current_time - result['created_at']
                if age > 1800:
                    zip_path = result.get('zip_path')
                    if zip_path and os.path.exists(zip_path):
                        try:
                            os.remove(zip_path)
                            print(f"🗑️ Removido arquivo abandonado: {os.path.basename(zip_path)}")
                        except:
                            pass
                    sessions_to_remove.append(session_id)

        for session_id in sessions_to_remove:
            if session_id in message_queues:
                del message_queues[session_id]
            if session_id in download_results:
                del download_results[session_id]


def start_cleanup_thread():
    """Start the background cleanup thread."""
    cleanup_thread = threading.Thread(target=cleanup_abandoned_sessions, daemon=True)
    cleanup_thread.start()
