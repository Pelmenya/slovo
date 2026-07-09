
import {Prisma,PermissionRiskLevel,PermissionStatus} from '@prisma/client'
import {ApiProperty} from '@nestjs/swagger'


export class PermissionDto {
  id: string ;
action: string ;
toolName: string ;
args: Prisma.JsonValue ;
@ApiProperty({
  enum: PermissionRiskLevel,
})
riskLevel: PermissionRiskLevel ;
@ApiProperty({
  enum: PermissionStatus,
})
status: PermissionStatus ;
@ApiProperty({
  type: `string`,
  format: `date-time`,
})
requestedAt: Date ;
@ApiProperty({
  type: `string`,
  format: `date-time`,
})
respondedAt: Date  | null;
respondedBy: string  | null;
reason: string  | null;
}
