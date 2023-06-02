import {toNano} from "ton-core";

export abstract class Conf {
    static readonly electorOpValue = toNano('1.03');
    static readonly minStorage     = toNano('2');
    static readonly depositFee     = toNano('0.25');
    static readonly withdrawlFee   = toNano('0.25');
    static readonly minStake       = toNano('50000');
};

export abstract class Op {
    static readonly controller = {
        newStake: 0x4e73744b
    }
    static readonly elector = {
        newStake: 0x4e73744b
    }
}

export abstract class Error {
 static readonly unknown_op = 0xffff;

 static readonly wrong_sender = 0x9283;
 static readonly wrong_state = 0x9284;

 static readonly sudoer = { quarantine : 0xa000};

 static readonly interest_too_low = 0xf100;
 static readonly contradicting_borrowing_params = 0xf101;
 static readonly not_enough_funds_for_loan = 0xf102;
 static readonly total_credit_too_high = 0xf103;

 static readonly deposit_amount_too_low = 0xf200;

 static readonly not_enough_TON_to_process = 0xf300;

 static readonly controller_in_wrong_workchain = 0xf400;
 static readonly credit_book_too_deep = 0xf401;

 static readonly finalizing_active_credit_round = 0xf500;

 static readonly too_early_stake_recover_attempt_count = 0xf600;
 static readonly too_early_stake_recover_attempt_time = 0xf601;
 static readonly too_low_recover_stake_value = 0xf602;
 static readonly not_enough_money_to_pay_fine = 0xf603;

 static readonly too_much_validator_set_counts = 0xf700;

 static readonly withdrawal_while_credited = 0xf800;
 static readonly incorrect_withdrawal_amount = 0xf801;


 static readonly newStake = {
    query_id: 0xf900,
    request_value : 0xf901,
    value_lt_minimum : 0xf902,
    value_too_high : 0xf903,
    wrongly_used_credit : 0xf904,
    solvency_not_guaranteed : 0xf905,
 }


 static readonly controller_not_approved = 0xfa00;
 static readonly multiple_loans_are_prohibited = 0xfa01;
 static readonly too_early_loan_request = 0xfa02;
 static readonly too_late_loan_request = 0xfa03;
 static readonly too_high_loan_request_amount = 0xfa04;

 static readonly no_credit = 0xfb00;
 static readonly too_early_loan_return = 0xfb01;
}
