import boto3
import json
import os

print('Loading function')


def respond(err, res=None):
    return {
        'isBase64Encoded': 'false',
        'statusCode': '400' if err else '200',
        'body': err.message if err else json.dumps(res),
        'headers': {
            'Content-Type': 'application/json',
        },
    }


def handler(event, context):
    json_data = {
        "res": "OKv4",
    }
    return respond(None, json_data)
