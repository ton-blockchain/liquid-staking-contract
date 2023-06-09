# Controller and Pool communication

File `ControllerPool.spec.ts` contains tests for actions where Pool and
Controller are the main participants.

There are only 2 actions like this: `request_loan` and `repay_loan`, which
are both starting as a message from controller to pool.


## Loan request

Pool should accept it only from controllers that were minted by this pool
with exact approver. Tests are need to cover 

Selected interest rate should be greater or eqal to pool's interest

Then pool should correctly add the loan to it's list. 

#### Marks
- 'Request loan bounce should only be accepted from pool address' is
already [done](https://github.com/EmelyanenkoK/jetton_pool/blob/controller_tests/tests/Controller.spec.ts#L434)

## Loan repayment 


