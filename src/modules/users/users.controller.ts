import { Body, Controller, Post } from '@nestjs/common';
import { UserRole } from '@/generated/prisma/enums';
import { Auth } from '@/shared/decorators/auth.decorator';
import { CreateUserDto } from './dto/create-user.dto';
import { CreateUserResponse } from './interfaces/user.interface';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  @Auth(UserRole.ADMIN)
  create(@Body() dto: CreateUserDto): Promise<CreateUserResponse> {
    return this.usersService.create(dto);
  }
}
