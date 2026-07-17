import { Module } from '@nestjs/common';
import { AriTransport } from './ari.transport';
import { TELEPHONY_TRANSPORT } from './telephony-transport.type';

@Module({
    providers: [{ provide: TELEPHONY_TRANSPORT, useClass: AriTransport }],
    exports: [TELEPHONY_TRANSPORT],
})
export class TelephonyModule {}
