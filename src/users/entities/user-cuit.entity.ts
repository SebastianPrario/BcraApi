import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, ManyToOne, Index } from 'typeorm';
import { User } from './user.entity';

@Entity('user_cuits')
export class UserCuit {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  @Index()
  cuit: string;

  @Column({ type: 'jsonb', nullable: true })
  lastFinancialStatus: any;

  @Column({ type: 'jsonb', nullable: true })
  lastRejectedChecks: any;

  @Column({ type: 'timestamp', nullable: true })
  lastCheckedAt: Date;

  @ManyToOne(() => User, (user) => user.cuits, { onDelete: 'CASCADE' })
  user: User;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
