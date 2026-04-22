
import {HealthCheckStatus} from '@prisma/client'
import {ApiProperty} from '@nestjs/swagger'


export class HealthCheck {
  id: string ;
service: string ;
@ApiProperty({
  enum: HealthCheckStatus,
})
status: HealthCheckStatus ;
@ApiProperty({
  type: `string`,
  format: `date-time`,
})
createdAt: Date ;
}
