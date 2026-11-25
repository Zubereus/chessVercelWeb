from http.server import BaseHTTPRequestHandler

from api import create_handler

_api_handler = create_handler("new-game")


class handler(BaseHTTPRequestHandler):
    """Expose the new-game endpoint using Vercel's Python handler entrypoint."""

    send_json = _api_handler.send_json
    read_json = _api_handler.read_json
    do_GET = _api_handler.do_GET
    do_POST = _api_handler.do_POST
    log_message = _api_handler.log_message
