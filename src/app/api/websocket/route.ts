import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  try {
    // Check if it's a WebSocket upgrade request
    const upgrade = request.headers.get('upgrade')?.toLowerCase();
    if (upgrade === 'websocket') {
      return new Response(null, {
        status: 101,
        headers: {
          'Upgrade': 'websocket',
          'Connection': 'Upgrade',
          'Sec-WebSocket-Accept': 'required-but-value-not-checked'
        }
      });
    }

    // If not a WebSocket request, return API info
    return NextResponse.json({
      message: 'WebSocket endpoint available at /api/websocket'
    });
  } catch (error) {
    console.error('API route error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
} 