
import {TurnRole,Intent} from '@prisma/client'
import {ApiProperty} from '@nestjs/swagger'
import {Call} from '../../call/entities/call.entity'


export class CallTurn {
  id: string ;
callId: string ;
call?: Call ;
@ApiProperty({
  description: `Порядковый номер реплики в диалоге, с 0`,
  type: `integer`,
  format: `int32`,
})
position: number ;
@ApiProperty({
  enum: TurnRole,
})
role: TurnRole ;
text: string ;
@ApiProperty({
  enum: Intent,
})
intent: Intent  | null;
@ApiProperty({
  description: `Путь к файлу записи ответа пациента (только реплики patient)`,
})
recordingPath: string  | null;
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
