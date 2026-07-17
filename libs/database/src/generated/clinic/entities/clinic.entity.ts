
import {Prisma} from '@prisma/client'
import {ApiProperty} from '@nestjs/swagger'
import {Call} from '../../call/entities/call.entity'


export class Clinic {
  id: string ;
name: string ;
@ApiProperty({
  description: `Голос SpeechKit TTS (alena, jane, marina...) — поле настройки клиники, не константа кода`,
})
ttsVoice: string ;
@ApiProperty({
  description: `Шаблоны фраз тенанта: greeting, reAsk, byeConfirmed... (ключ → текст с плейсхолдерами)`,
})
phraseTemplates: Prisma.JsonValue  | null;
@ApiProperty({
  description: `Неймспейс env-переменных тенанта (SIP_USER_<ns> и т.д.) — секреты живут в env, не в БД`,
})
envNamespace: string ;
isActive: boolean ;
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
calls?: Call[] ;
}
