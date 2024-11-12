import {
  OnOffCluster,
  PlatformConfig,
  bridgedNode,
  onOffSwitch,
  powerSource,
} from 'matterbridge';
import { Matterbridge, /* MatterbridgeEndpoint as */ MatterbridgeDevice, MatterbridgeDynamicPlatform } from 'matterbridge';
import { isValidBoolean } from 'matterbridge/utils';
import { AnsiLogger } from 'matterbridge/logger';

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


export class ExampleMatterbridgeDynamicPlatform extends MatterbridgeDynamicPlatform {
  switch: MatterbridgeDevice | undefined;

  switchInterval: NodeJS.Timeout | undefined;

  constructor(matterbridge: Matterbridge, log: AnsiLogger, config: PlatformConfig) {
    super(matterbridge, log, config);

    // Verify that Matterbridge is the correct version
    if (this.verifyMatterbridgeVersion === undefined || typeof this.verifyMatterbridgeVersion !== 'function' || !this.verifyMatterbridgeVersion('1.6.0')) {
      throw new Error(
        `This plugin requires Matterbridge version >= "1.6.0". Please update Matterbridge from ${this.matterbridge.matterbridgeVersion} to the latest version in the frontend."`,
      );
    }

    this.log.info('Initializing platform:', this.config.name);
  }

  override async onStart(reason?: string) {
    this.log.info('onStart called with reason:', reason ?? 'none');

    // Create a switch device
    this.switch = new MatterbridgeDevice([onOffSwitch, bridgedNode], { uniqueStorageKey: 'riggedWOL' }, this.config.debug as boolean);
    this.switch.log.logName = 'Switch';
    this.switch.createDefaultIdentifyClusterServer();
    this.switch.createDefaultGroupsClusterServer();
    this.switch.createDefaultScenesClusterServer();
    this.switch.createDefaultBridgedDeviceBasicInformationClusterServer('rigged', '0x23452164', 0xfff1, 'Lenovo Legion', '90UT0000US');
    this.switch.createDefaultOnOffClusterServer();
    this.switch.addDeviceType(powerSource);
    this.switch.createDefaultPowerSourceRechargeableBatteryClusterServer(70);
    await this.registerDevice(this.switch);

    this.switch.addCommandHandler('identify', async ({ request: { identifyTime } }) => {
      this.log.info(`Command identify called identifyTime:${identifyTime}`);
    });
    this.switch.addCommandHandler('on', async () => {
      await magicPacket({macAddress: "00:1F:5B:3A:9B:3A"});
      this.switch?.setAttribute(OnOffCluster.id, 'onOff', true, this.switch.log);
    });
    this.switch.addCommandHandler('off', async () => {
      await fetch("http://172.16.0.179:8009/shutdown")
      this.switch?.setAttribute(OnOffCluster.id, 'onOff', false, this.switch.log);
    });

  }

  override async onConfigure() {
    const setStatus = async () => {
      const status = await pingHost("172.16.0.179")
      if (isValidBoolean(status)) {
        this.switch?.setAttribute(OnOffCluster.id, 'onOff', status, this.switch.log);
      }
    }
    
    setStatus()

    this.switchInterval = setInterval(setStatus, 1000);

  }

  override async onShutdown(reason?: string) {
    this.log.info('onShutdown called with reason:', reason ?? 'none');
    clearInterval(this.switchInterval);
    if (this.config.unregisterOnShutdown === true) await this.unregisterAllDevices();
  }
}
