import dgram from "node:dgram";
import { exec } from "child_process";

const magicPacket = async ({macAddress, broadcastAddress = "255.255.255.255", port = 9}: {macAddress: string, broadcastAddress?: string, port?: number}) => {
  const macBytes = macAddress.split(":").map((byte: string) => parseInt(byte, 16));
  const packet = Buffer.alloc(102);

  // Fill the packet with 6 bytes of 0xFF followed by the MAC address repeated 16 times
  for (let i = 0; i < 6; i++) {
      packet[i] = 0xFF;
  }
  for (let i = 6; i < packet.length; i += macBytes.length) {
      macBytes.forEach((byte: number, index: number) => {
          packet[i + index] = byte;
      });
  }

  const socket = dgram.createSocket("udp4");

  return new Promise<void>((resolve, reject) => {
      socket.bind(() => {
          socket.setBroadcast(true);
          socket.send(packet, 0, packet.length, port, broadcastAddress, (err) => {
              if (err) {
                  reject(`Error sending magic packet: ${err}`);
              } else {
                  console.log("Magic packet sent to", macAddress);
                  resolve();
              }
              socket.close();
          });
      });
  });
}

const pingHost = async (host: String) => {
  return new Promise((resolve, reject) => {
      // Different ping command based on the OS
      const platform = process.platform;
      const command = platform === "win32" ? `ping -n 1 ${host}` : `ping -c 1 ${host}`;

      exec(command, (error, stdout) => {
          if (error) {
              // Host is unreachable
              resolve(false);
          } else if (stdout.includes("time=") || stdout.includes("TTL=")) {
              // Host is alive
              resolve(true);
          } else {
              // Host is unreachable
              resolve(false);
          }
      });
  });
}

const setStatus = async () => {
    const status = await pingHost("172.16.0.179")
    console.log(status)
  }

  setInterval(setStatus)