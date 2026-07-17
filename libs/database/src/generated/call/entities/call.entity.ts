
import {CallStatus,CallOutcome} from '@prisma/client'
import {ApiProperty} from '@nestjs/swagger'
import {Clinic} from '../../clinic/entities/clinic.entity'
import {CallTurn} from '../../call-turn/entities/call-turn.entity'


export class Call {
  id: string ;
clinicId: string ;
clinic?: Clinic ;
phone: string ;
patientName: string ;
@ApiProperty({
  type: `string`,
  format: `date-time`,
})
appointmentAt: Date ;
@ApiProperty({
  enum: CallStatus,
})
status: CallStatus ;
@ApiProperty({
  enum: CallOutcome,
})
outcome: CallOutcome  | null;
channelId: string  | null;
@ApiProperty({
  type: `string`,
  format: `date-time`,
})
dialedAt: Date  | null;
@ApiProperty({
  type: `string`,
  format: `date-time`,
})
answeredAt: Date  | null;
@ApiProperty({
  type: `string`,
  format: `date-time`,
})
endedAt: Date  | null;
@ApiProperty({
  type: `integer`,
  format: `int32`,
})
durationSeconds: number  | null;
@ApiProperty({
  type: `integer`,
  format: `int32`,
})
ttsChars: number ;
@ApiProperty({
  type: `integer`,
  format: `int32`,
})
sttSeconds: number ;
@ApiProperty({
  type: `integer`,
  format: `int32`,
})
llmInputTokens: number ;
@ApiProperty({
  type: `integer`,
  format: `int32`,
})
llmOutputTokens: number ;
@ApiProperty({
  type: `integer`,
  format: `int32`,
})
costKopecks: number  | null;
turns?: CallTurn[] ;
@ApiProperty({
  type: `string`,
  format: `date-time`,
})
createdAt: Date ;
@ApiProperty({
  type: `string`,
  format: `date-time`,
})
updatedAt: Date ;
}
