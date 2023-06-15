import {toNano} from "ton-core";

export abstract class Conf {
    static readonly electorOpValue = toNano('1.03');
    static readonly minStorage     = toNano('2');
    static readonly depositFee     = toNano('0.25');
    static readonly withdrawlFee   = toNano('0.25');
    static readonly minStake       = toNano('50000');
    static readonly hashUpdateFine = toNano('10');
    static readonly stakeRecoverFine = toNano('10');
    static readonly gracePeriod    = 600;
    static readonly sudoQuarantine = 86400;
};

export abstract class Op {
    static readonly controller = {
        top_up : 0xd372158c,
        update_validator_hash : 0xf0fd2250,
        approve : 0x7b4b42e6,
        disapprove : 0xe8a0abfe,
        recover_stake : 0xeb373a05,
        credit : 0x1690c604,
        withdraw_validator : 0xcefaaefd,
        return_unused_loan : 0xed7378a6,
        send_request_loan: 0x452f7112,
        newStake: 0x4e73744b
    }
    static readonly elector = {
        new_stake: 0x4e73744b,
        new_stake_ok: 0xf374484c,
        new_stake_error: 0xee6f454c,
        recover_stake: 0x47657424,
        recover_stake_ok: 0xf96f7324,
        recover_stake_error:0xfffffffe
    }
    static readonly pool = {
        request_loan   : 0x7ccd46e9,
        repay_loan : 0xdfdca27b,
        deposit        : 0x47d54391,
        withdraw       : 0x319b0cdc, //TODO
        withdrawal     : 0x31777cdc, //TODO
        deploy_controller : 0xdf108122
    }
    static readonly governor = {
        set_sudoer : 0x79e7c016,
        set_roles  : 0x7a756db8, // TODO
        unhalt  : 0x7247e7a5,
        operation_fee : 0x93a, // TODO
        return_available_funds: 0x67855098,
        set_deposit_settings : 0x2233ff55
    }
    static readonly sudo = {
        send_message : 0x270695fb,
        upgrade : 0x96e7f528
    }
    static readonly halter = {
        halt : 0x139a1b4e
    }
}

export abstract class ControllerState {
    static readonly REST = 0;
    static readonly SENT_BORROWING_REQUEST = 1;
    static readonly SENT_STAKE_REQUEST = 2;
    static readonly FUNDS_STAKEN = 3;
    static readonly SENT_RECOVER_REQUEST = 4;
    static readonly INSOLVENT = 5;
}
export abstract class Errors {
 static readonly success = 0;
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
 static readonly halted = 0x9285;


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
