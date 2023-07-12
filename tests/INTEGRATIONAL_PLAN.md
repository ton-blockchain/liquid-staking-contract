# Integrational testing plan

## Normal pessimistic mode
### Deposit
- Should mint according amount
- Repeated deposits should add up


### Make round
- Deposit
- Stake
- Recover stake
- Withdraw

### Check how profit/loss impacts pTON exchange course

## Optimistic mode
### Make round
- Deposit
- Stake
- Recover stake
- Withdraw
### Test fill or kill
Reverse mint

## Other
- Check how profit/loss impacts pTON exchange course
- Check how governance fee impacts things
- Sudo requests
- Check pool halts when lacks balance for withdraw
- Test controller position address



## Attacks

- Top up ddos
- Zero balance NFT mint
- Micro values withdraw hoping for rounding errors
- Burnouts (Long deposit/withdraw) chains hoping something would break

