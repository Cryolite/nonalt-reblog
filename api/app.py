import math
import io
import logging
from base64 import b64decode
from typing import Optional
import jsonschema
import requests
import numpy
from PIL import Image
import cv2
import flask
import flask_cors


app = flask.Flask(__name__)
cors = flask_cors.CORS(app, resources={
    r'/match': {
        'origins': ['chrome-extension://*'],
        'methods': ['POST'],
        'allow_headers': ['Content-Type']
    },
    r'/proxy-to-pixiv': {
        'origins': ['chrome-extension://*'],
        'methods': ['POST'],
        'allow_headers': ['Content-Type']
    }
})


_REQUEST_IMAGE_BLOB_JSON_SCHEMA = {
    'type': 'object',
    'required': [
        'mime',
        'blob'
    ],
    'properties': {
        'artistUrl': {
            'type': 'string'
        },
        'imageUrl': {
            'type': 'string'
        },
        'mime': {
            'type': 'string'
        },
        'blob': {
            'type': 'string'
        }
    },
    'additionalProperties': False
}

_REQUEST_JSON_SCHEMA = {
    'type': 'object',
    'required': [
        'sources',
        'targets'
    ],
    'properties': {
        'sources': {
            'type': 'array',
            'minItems': 1,
            'items': _REQUEST_IMAGE_BLOB_JSON_SCHEMA
        },
        'targets': {
            'type': 'array',
            'minItems': 1,
            'items': _REQUEST_IMAGE_BLOB_JSON_SCHEMA
        }
    },
    'additionalProperties': False
}


def _blobToImage(mime: str, blob: str) -> Optional[numpy.ndarray]:
    blob = b64decode(blob)
    image = Image.open(io.BytesIO(blob))
    if image.getbands() == ('R', 'G', 'B'):
        image = numpy.array(image)
        image = cv2.cvtColor(image, cv2.COLOR_RGB2BGR)
    elif image.getbands() == ('R', 'G', 'B', 'A'):
        image = numpy.array(image)
        image = cv2.cvtColor(image, cv2.COLOR_RGBA2BGR)
    elif image.getbands() == ('L',):
        image = numpy.array(image)
        image = cv2.cvtColor(image, cv2.COLOR_GRAY2BGR)
    elif image.getbands() == ('P',):
        # TODO: The following conversion is incorrect.
        image = numpy.array(image)
        image = cv2.cvtColor(image, cv2.COLOR_GRAY2BGR)
    else:
        raise RuntimeError(f'{image.getbands()}: An unsupported bands.')
    return image


def _getMatchScore(source_image: numpy.ndarray, target_image: numpy.ndarray) -> float:
    source_height, source_width = source_image.shape[0:2]
    target_height, target_width = target_image.shape[0:2]
    if source_height > target_height or source_width > target_width:
        return 0.0

    target_image = cv2.resize(
        target_image, (source_width, source_height),
        interpolation=cv2.INTER_LANCZOS4)

    result1: numpy.ndarray = cv2.matchTemplate(
        target_image, source_image, cv2.TM_CCOEFF_NORMED)
    if result1.shape != (1, 1):
        raise AssertionError()
    match_score0 = (result1[0, 0] + 1.0) / 2.0
    result2: numpy.ndarray = cv2.matchTemplate(
        target_image, source_image, cv2.TM_SQDIFF_NORMED)
    if result2.shape != (1, 1):
        raise AssertionError()
    match_score1 = 1.0 - result2[0, 0]

    return math.sqrt(match_score0 * match_score1)


@app.route('/match', methods=('POST',))
def match():
    if flask.request.method != 'POST':
        return f'`{flask.request.method}` is not allowed.', 405

    if flask.request.mimetype != 'application/json':
        return f'`{flask.request.mimetype}` is not an allowed mimetype.', 400

    data = flask.request.json
    from jsonschema.exceptions import (SchemaError, ValidationError,)
    try:
        jsonschema.validate(data, _REQUEST_JSON_SCHEMA)
    except SchemaError as e:
        logging.exception(e)
        return e.message, 500
    except ValidationError as e:
        logging.exception(e)
        return e.message, 400

    source_images = []
    for source in data['sources']:
        mime: str = source['mime']
        blob: str = source['blob']
        source_image = _blobToImage(mime, blob)
        source_images.append(source_image)

    target_images = []
    for target in data['targets']:
        mime: str = target['mime']
        blob: str = target['blob']
        target_image = _blobToImage(mime, blob)
        target_images.append(target_image)

    response = []
    for source_image in source_images:
        match_score_max = 0.0
        argmax_index = 0
        for index, target_image in enumerate(target_images):
            match_score = _getMatchScore(source_image, target_image)
            if match_score > match_score_max:
                match_score_max = match_score
                argmax_index = index
        response.append({
            'index': argmax_index,
            'score': match_score_max
        })

    return flask.jsonify(response)


_PROXY_TO_PIXIV_REQUEST_SCHEMA = {
    'type': 'object',
    'required': [
        'url',
        'referrer'
    ],
    'properties': {
        'url': {
            'type': 'string'
        },
        'referrer': {
            'type': 'string'
        }
    },
    'additionalProperties': False
}


@app.route('/proxy-to-pixiv', methods=('POST',))
def proxy():
    if flask.request.method != 'POST':
        return f'`{flask.request.method}` is not allowed.', 405

    if flask.request.mimetype != 'application/json':
        return f'`{flask.request.mimetype}` is not an allowed mimetype.', 400

    data = flask.request.json
    from jsonschema.exceptions import (SchemaError, ValidationError,)
    try:
        jsonschema.validate(data, _PROXY_TO_PIXIV_REQUEST_SCHEMA)
    except SchemaError as e:
        logging.exception(e)
        return e.message, 500
    except ValidationError as e:
        logging.exception(e)
        return e.message, 400

    new_headers = dict(flask.request.headers)
    del new_headers['Host']
    del new_headers['Content-Type']
    del new_headers['Content-Length']
    new_headers['Authority'] = 'i.pximg.net'
    new_headers['Referer'] = data['referrer']
    new_headers['Sec-Fetch-Mode'] = 'navigate'
    new_headers['Sec-Fetch-User'] = '?1'
    new_headers['Sec-Fetch-Dest'] = 'document'
    logging.error(new_headers)
    r = requests.get(data['url'], headers=new_headers)

    return flask.Response(
        r.content, status=r.status_code, content_type=r.headers['Content-Type'])
